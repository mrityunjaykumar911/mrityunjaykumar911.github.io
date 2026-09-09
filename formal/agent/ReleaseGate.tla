----------------------------- MODULE ReleaseGate -----------------------------
EXTENDS Naturals, Sequences, FiniteSets

CONSTANTS MaxRevision, MaxPolicy, MaxAttempt, Omit

\* CHECKED DOMAIN ONLY: one artifact, one policy, one release destination;
\* revision/policy IDs 1..2, attempt IDs 1..2 (0 means no attempt yet).
\* There can be one edit, one policy change, two check starts and completions,
\* one cancellation, one prepare, and at most two commits. Non-commit actions
\* stop at the first publication. There is no unbounded/liveness/fairness claim,
\* no ABA ID reuse, and no claim about hashes, I/O, or distributed atomicity.
\* Terminal states intentionally stutter (CHECK_DEADLOCK FALSE in the configs).
\*
\* Recheck captures a real revision/policy/attempt snapshot into pending work.
\* Finish can deliver either outstanding attempt in either order with a
\* success/fail/unknown result and complete/incomplete inventory. Superseded
\* checks can therefore overwrite the live evidence with an old result.
\* Prepare freezes the artifact/evidence ticket; Edit, ChangePolicy, Recheck,
\* Finish and Cancel remain possible before Commit (including after Prepare).
\*
\* ASSOCIATION WITH THE RUNTIME TABLE: Ready uses GateCatalog!Gate. The first
\* seven facts describe live evidence and current control state. The eighth
\* compares the frozen ticket with live evidence. Commit publishes the FROZEN
\* ticket, not the newly checked artifact. The caller must atomically read the
\* eight authoritative facts and perform the release; the truth table alone
\* cannot supply that atomicity. This is a finite specification check, not a
\* proof that a particular host implementation refines these actions.
\*
\* Each mutant changes exactly one enabling fact, never ReleaseSafe. Safety
\* inspects immutable publication records against context at the actual commit;
\* it does not assert a flag set by a gate, nor test the current mutable context.
\* A duplicate is an observable second append. The TOCTOU mutant can prepare,
\* edit, recheck successfully, then publish the OLD ticket while the other
\* seven live facts all hold. The verifier also inspects the safe state dump
\* for a nonempty publication, so a gate that blocks every release cannot pass.

VARIABLES revision, policy, attempt, evidence, pending, ticket, cancelled,
          publications

vars == <<revision, policy, attempt, evidence, pending, ticket, cancelled,
          publications>>

Catalog == INSTANCE GateCatalog WITH
    checksPassed <- TRUE,
    inventoryComplete <- TRUE,
    revisionMatches <- TRUE,
    policyMatches <- TRUE,
    attemptMatches <- TRUE,
    notCancelled <- TRUE,
    notReleased <- TRUE,
    ticketMatches <- TRUE,
    allowed <- TRUE

NoEvidence == [revision |-> 0, policy |-> 0, attempt |-> 0,
               status |-> "none", inventory |-> FALSE]
Job == [revision : 1..MaxRevision, policy : 1..MaxPolicy,
        attempt : 1..MaxAttempt]
Evidence == [revision : 0..MaxRevision, policy : 0..MaxPolicy,
             attempt : 0..MaxAttempt,
             status : {"none", "pending", "success", "fail", "unknown"},
             inventory : BOOLEAN]
Publication == [artifact : Evidence, revision : 1..MaxRevision,
                policy : 1..MaxPolicy, attempt : 0..MaxAttempt,
                cancelled : BOOLEAN]

Init ==
    /\ revision = 1
    /\ policy = 1
    /\ attempt = 0
    /\ evidence = NoEvidence
    /\ pending = {}
    /\ ticket = NoEvidence
    /\ cancelled = FALSE
    /\ publications = <<>>

Live == Len(publications) = 0

Edit ==
    /\ Live
    /\ revision < MaxRevision
    /\ revision' = revision + 1
    /\ UNCHANGED <<policy, attempt, evidence, pending, ticket, cancelled,
                   publications>>

ChangePolicy ==
    /\ Live
    /\ policy < MaxPolicy
    /\ policy' = policy + 1
    /\ UNCHANGED <<revision, attempt, evidence, pending, ticket, cancelled,
                   publications>>

Recheck ==
    /\ Live
    /\ attempt < MaxAttempt
    /\ attempt' = attempt + 1
    /\ pending' = pending \cup {[revision |-> revision, policy |-> policy,
                                attempt |-> attempt + 1]}
    /\ evidence' = [revision |-> revision, policy |-> policy,
                    attempt |-> attempt + 1, status |-> "pending",
                    inventory |-> FALSE]
    /\ UNCHANGED <<revision, policy, ticket, cancelled, publications>>

Finish ==
    /\ Live
    /\ \E job \in pending, result \in {"success", "fail", "unknown"},
          complete \in BOOLEAN :
        /\ pending' = pending \ {job}
        /\ evidence' = [revision |-> job.revision, policy |-> job.policy,
                        attempt |-> job.attempt, status |-> result,
                        inventory |-> complete]
    /\ UNCHANGED <<revision, policy, attempt, ticket, cancelled, publications>>

Cancel ==
    /\ Live
    /\ ~cancelled
    /\ cancelled' = TRUE
    /\ UNCHANGED <<revision, policy, attempt, evidence, pending, ticket,
                   publications>>

\* Only the selected mutant overrides a fact. Prepare checks the first seven;
\* Commit checks all eight. Failure/unknown/pending are never checksPassed.
Facts(requireTicket) == [
    checksPassed |-> evidence.status = "success",
    inventoryComplete |-> (Omit = "inventoryComplete" \/ evidence.inventory),
    revisionMatches |-> (Omit = "artifactFreshness"
                        \/ evidence.revision = revision),
    policyMatches |-> (Omit = "policyFreshness" \/ evidence.policy = policy),
    attemptMatches |-> (Omit = "attemptFreshness" \/ evidence.attempt = attempt),
    notCancelled |-> (Omit = "cancellation" \/ ~cancelled),
    notReleased |-> (Omit = "duplicateRelease" \/ Len(publications) = 0),
    ticketMatches |-> (~requireTicket \/ Omit = "ticketRevalidation"
                      \/ ticket = evidence)]

Ready(requireTicket) == Catalog!Gate(Facts(requireTicket))

Prepare ==
    /\ Live
    /\ ticket = NoEvidence
    /\ Ready(FALSE)
    /\ ticket' = evidence
    /\ UNCHANGED <<revision, policy, attempt, evidence, pending, cancelled,
                   publications>>

Commit ==
    /\ ticket # NoEvidence
    /\ Len(publications) < 2
    /\ Ready(TRUE)
    /\ publications' = Append(publications,
        [artifact |-> ticket, revision |-> revision, policy |-> policy,
         attempt |-> attempt, cancelled |-> cancelled])
    /\ UNCHANGED <<revision, policy, attempt, evidence, pending, ticket,
                   cancelled>>

Next == Edit \/ ChangePolicy \/ Recheck \/ Finish \/ Cancel \/ Prepare \/ Commit

TypeOK ==
    /\ revision \in 1..MaxRevision
    /\ policy \in 1..MaxPolicy
    /\ attempt \in 0..MaxAttempt
    /\ evidence \in Evidence
    /\ pending \subseteq Job
    /\ Cardinality(pending) <= MaxAttempt
    /\ ticket \in Evidence
    /\ cancelled \in BOOLEAN
    /\ publications \in Seq(Publication)
    /\ Len(publications) <= 2

ReleaseSafe ==
    /\ Len(publications) <= 1
    /\ \A i \in 1..Len(publications) :
        LET release == publications[i] IN
        /\ release.artifact.status = "success"
        /\ release.artifact.inventory = TRUE
        /\ release.artifact.revision = release.revision
        /\ release.artifact.policy = release.policy
        /\ release.artifact.attempt = release.attempt
        /\ release.cancelled = FALSE
=============================================================================