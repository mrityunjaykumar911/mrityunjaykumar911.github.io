------------------------------- MODULE Disclosure -------------------------------
(***************************************************************************)
(* DISCLOSURE POLICY for a published web artifact.                         *)
(*                                                                         *)
(* Replaces ResumePublication.tla. That model tracked one boolean about one *)
(* kind of private content reaching one kind of page. This one states the   *)
(* general property both it and the Playwright suite were approximating:    *)
(*                                                                         *)
(*    no published sink ever carries content above its clearance.           *)
(*                                                                         *)
(* NOT A NOVEL MECHANISM. This is standard lattice-based information flow   *)
(* control (Denning 1976) applied to a static site's build graph. What is   *)
(* being designed here is the engine around it: where the labels come from, *)
(* which sinks are enumerated, what counts as a declassifier, and how the   *)
(* abstract policy is discharged against the bytes actually emitted.        *)
(*                                                                         *)
(* WHY A MODEL AND NOT JUST THE CHECKER. The checker inspects the artifact  *)
(* and can only see sinks it was pointed at. The model quantifies over the  *)
(* declared sink set, so it can state the property the checker structurally *)
(* cannot: that every published sink is audited at all. Two real defects in *)
(* the worked example were found through exactly that gap -- see DESIGN.md  *)
(* findings F1 and F2.                                                      *)
(***************************************************************************)
EXTENDS Integers, FiniteSets

CONSTANTS
    Source,          \* content sources, e.g. resume.yaml, resume.local.yaml
    Sink,            \* published artifacts, e.g. index.html, the CV PDF
    SrcAud,          \* [Source -> {"public","flagged","local"}]
    SrcPII,          \* [Source -> BOOLEAN]  does this source carry contact PII
    Clearance,       \* [Sink -> {"public","flagged","local"}]
    SinkAllowsPII,   \* [Sink -> BOOLEAN]
    Flows,           \* [Sink -> SUBSET Source]  which sources feed which sink
    Declassed,       \* [Sink -> SUBSET Source]  declared declassification points
    Audited,         \* SUBSET Sink -- the sinks the artifact checker actually opens
    StripsLocal      \* does the production build actually drop local-labelled sources

(***************************************************************************)
(* The lattice. Audience is a total order; PII is an orthogonal flag. A     *)
(* label is the pair, and join is componentwise.                           *)
(***************************************************************************)
Aud == {"public", "flagged", "local"}
Rank(a) == CASE a = "public"  -> 0
             [] a = "flagged" -> 1
             [] a = "local"   -> 2

Max2(a, b) == IF Rank(a) >= Rank(b) THEN a ELSE b

(***************************************************************************)
(* Declassification. A source listed in Declassed[k] is treated as public   *)
(* and non-PII on the path to sink k.                                      *)
(*                                                                         *)
(* This is the load-bearing modelling decision, so it is stated explicitly: *)
(* declassification is a DECLARED SET, never a property of a transformation.*)
(* An encoding is not a declassifier. Reversing a string, base64, ROT13 or  *)
(* splitting it across attributes all preserve the information and so       *)
(* preserve the label. Only a transformation that destroys the information  *)
(* -- dropping the field, truncating to a non-identifying prefix, replacing *)
(* it with a form endpoint -- may appear here, and it must be written down  *)
(* rather than inferred, because nothing downstream can tell the difference *)
(* by looking at bytes.                                                     *)
(***************************************************************************)
EffAud(k, s) == IF s \in Declassed[k] THEN "public" ELSE SrcAud[s]
EffPII(k, s) == SrcPII[s] /\ s \notin Declassed[k]

(***************************************************************************)
(* Production drops the local overlay. In the worked example this is one    *)
(* expression, src/data/resume.ts:                                          *)
(*                                                                         *)
(*   const overlay = import.meta.env.DEV && localOverlay                    *)
(*                     ? localOverlay : publicOverlay                       *)
(*                                                                         *)
(* Every disclosure guarantee of the built site rests on that ternary. It   *)
(* is worth having the model say so.                                        *)
(***************************************************************************)
LocalSources == { s \in Source : SrcAud[s] = "local" }

VARIABLES mode, published, audit

vars == << mode, published, audit >>

ActiveFlows(k) == IF mode = "prod" /\ StripsLocal
                  THEN Flows[k] \ LocalSources
                  ELSE Flows[k]

RECURSIVE JoinAud(_, _)
JoinAud(k, S) ==
    IF S = {} THEN "public"
    ELSE LET s == CHOOSE x \in S : TRUE
         IN Max2(EffAud(k, s), JoinAud(k, S \ {s}))

ContentAud(k) == JoinAud(k, ActiveFlows(k))
ContentPII(k) == \E s \in ActiveFlows(k) : EffPII(k, s)

TypeOK ==
    /\ mode \in {"dev", "prod"}
    /\ published \subseteq Sink
    /\ audit \in {"pending", "pass", "fail"}

Init ==
    /\ mode = "dev"
    /\ published = {}
    /\ audit = "pending"

EnterProduction ==
    /\ mode' = "prod"
    /\ audit' = "pending"          \* a mode change invalidates a prior audit
    /\ UNCHANGED published

ReturnToDevelopment ==
    /\ mode' = "dev"
    /\ audit' = "pending"
    /\ UNCHANGED published

(* The artifact checker runs over the audited sinks. It passes only when
   every audited sink is within its clearance. It cannot speak for a sink it
   never opened, which is the whole point of PublishedSinksAreAudited. *)
RunAudit ==
    /\ audit' = IF \A k \in (published \cap Audited) :
                      /\ Rank(ContentAud(k)) =< Rank(Clearance[k])
                      /\ ContentPII(k) => SinkAllowsPII[k]
                 THEN "pass" ELSE "fail"
    /\ UNCHANGED << mode, published >>

Publish ==
    /\ mode = "prod"
    /\ audit = "pass"
    /\ published \cap Audited = published    \* refuse to ship an unaudited sink
    /\ published' = Sink
    /\ UNCHANGED << mode, audit >>

StageSink(k) ==
    /\ k \notin published
    /\ published' = published \cup {k}
    /\ audit' = "pending"                    \* staging invalidates the audit
    /\ UNCHANGED mode

SafeNext ==
    \/ EnterProduction
    \/ ReturnToDevelopment
    \/ RunAudit
    \/ Publish
    \/ \E k \in Sink : StageSink(k)

SafeSpec == Init /\ [][SafeNext]_vars

(***************************************************************************)
(* THE PROPERTIES                                                          *)
(***************************************************************************)

(* P1. The core disclosure property. Generalises NoPrivateInProduction:     *)
(*     that invariant was the single instance Clearance = "public",         *)
(*     Source = the local overlay.                                          *)
SinkWithinClearance ==
    \A k \in published :
        /\ Rank(ContentAud(k)) =< Rank(Clearance[k])
        /\ ContentPII(k) => SinkAllowsPII[k]

(* P2. The one a test suite structurally cannot state. A hand-written test  *)
(*     asserts things about sinks somebody remembered; it has no way to     *)
(*     assert that the sink SET is complete. Finding F2 in DESIGN.md is a   *)
(*     published PDF that no assertion ever opened.                         *)
PublishedSinksAreAudited == published \subseteq Audited

(* P3. Production never carries local-labelled content, whatever the route. *)
ProdCarriesNoLocal ==
    mode = "prod" => \A k \in published : ActiveFlows(k) \cap LocalSources = {}

(* P4. Shipping requires a passing audit over a complete sink set.          *)
PublishRequiresAudit ==
    published # {} => (audit = "pass" \/ mode = "dev")

Safety ==
    /\ TypeOK
    /\ SinkWithinClearance
    /\ PublishedSinksAreAudited
    /\ ProdCarriesNoLocal

(***************************************************************************)
(* NON-VACUITY.                                                            *)
(*                                                                         *)
(* The first attempt mutated this SPEC -- publish without auditing, audit   *)
(* while ignoring PII, publish with no audit at all. All three passed, and  *)
(* the reason is worth recording: these invariants are properties of the    *)
(* POLICY-ARTIFACT PAIR, not of the transition relation. Against a policy   *)
(* in which nothing is over-clearance and every sink is audited, removing a *)
(* guard cannot expose anything, so every spec mutant is vacuous.           *)
(*                                                                         *)
(* Mutation therefore belongs on the policy. gen_policy_tla.py emits three  *)
(* policy mutants from the fixed policy, each targeting one invariant:      *)
(*                                                                         *)
(*   MutUnaudited  drop the CV PDF from the audited set                     *)
(*                    -> must violate PublishedSinksAreAudited   (F2)       *)
(*   MutPIIBlind   drop the email declassification                          *)
(*                    -> must violate SinkWithinClearance        (F1)       *)
(*   MutLocalLeak  let the local overlay reach the index page               *)
(*                    -> must violate ProdCarriesNoLocal                    *)
(*                                                                         *)
(* PolicyCurrent is a fourth, non-synthetic counterexample: the repository  *)
(* as it stands already violates Safety.                                    *)
(***************************************************************************)

=============================================================================
