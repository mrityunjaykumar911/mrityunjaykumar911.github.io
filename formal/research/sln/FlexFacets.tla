-------------------------------- MODULE FlexFacets --------------------------------
(***************************************************************************)
(* Multi-facet model of flex item independence.                            *)
(*                                                                         *)
(* Question: for which items is the used main size invariant under a change *)
(* to a SIBLING's flex base size, across a RANGE of container widths?      *)
(*                                                                         *)
(* Why a checker: the container width is a free parameter ranged over an    *)
(* interval, independence is an invariant over that range, and items are    *)
(* independent for structurally DIFFERENT reasons. TLC explores the whole   *)
(* configuration space crossed with the width range and returns a concrete  *)
(* counterexample for any candidate condition that is unsound or            *)
(* incomplete.                                                              *)
(*                                                                         *)
(* Browser measurement (250 pages, 519 containers, 1309 items) found 73.3%  *)
(* of items independent across 320..1920px. This model must say WHICH and   *)
(* WHY, using a condition an engine can evaluate locally.                   *)
(*                                                                         *)
(* ARITHMETIC CAVEAT. TLA+ has integers only, and the spec distributes free *)
(* space proportionally, which is rational. Division below is floor         *)
(* division. Every counterexample TLC reports is therefore re-checked       *)
(* against the exact-rational Python model in sln/flexmodel.py, which is    *)
(* validated at 100% against Chromium on 3000 cases. A counterexample the   *)
(* exact model does not reproduce is a rounding artefact and is discarded.  *)
(***************************************************************************)
EXTENDS Integers, FiniteSets

CONSTANTS
    N,        \* item count
    INF,      \* sentinel standing for an absent max main size
    Widths,   \* container main sizes to range over: the interval
    Bases,    \* possible flex base sizes
    Factors,  \* possible grow / shrink factors
    Mins,     \* possible used min main sizes
    Maxes     \* possible used max main sizes, including INF

Items == 1..N

Min2(a, b) == IF a < b THEN a ELSE b
Max2(a, b) == IF a > b THEN a ELSE b
Clamp(v, lo, hi) == IF hi = INF THEN Max2(v, lo) ELSE Max2(Min2(v, hi), lo)

RECURSIVE SumUpTo(_, _)
SumUpTo(f, k) == IF k = 0 THEN 0 ELSE f[k] + SumUpTo(f, k - 1)
Sum(f) == SumUpTo(f, N)

Config == [ Items -> [ basis  : Bases,
                       grow   : Factors,
                       shrink : Factors,
                       min    : Mins,
                       max    : Maxes ] ]

(* Hypothetical main size: basis clamped by the item's own min and max. *)
Hyp(cfg, i)      == Max2(0, Clamp(cfg[i].basis, cfg[i].min, cfg[i].max))
OuterHypSum(cfg) == Sum([ i \in Items |-> Hyp(cfg, i) ])

(* Step 1: which factor is in use. Note this is a CONTAINER-level fact, so a
   condition may mention it and remain locally evaluable. *)
Growing(cfg, C) == OuterHypSum(cfg) < C
Fac(cfg, C, i)  == IF Growing(cfg, C) THEN cfg[i].grow ELSE cfg[i].shrink

(* Step 3 predicates. These are the raw material for the facets. *)
ZeroFactor(cfg, C, i)    == Fac(cfg, C, i) = 0
BasisBelowMin(cfg, i)    == cfg[i].basis < cfg[i].min
BasisAboveMax(cfg, i)    == cfg[i].max # INF /\ cfg[i].basis > cfg[i].max

Step3Frozen(cfg, C) ==
    { i \in Items :
        \/ ZeroFactor(cfg, C, i)
        \/ (Growing(cfg, C)  /\ BasisAboveMax(cfg, i))
        \/ (~Growing(cfg, C) /\ BasisBelowMin(cfg, i)) }

InitTarget(cfg, C) ==
    [ i \in Items |-> IF i \in Step3Frozen(cfg, C) THEN Hyp(cfg, i) ELSE cfg[i].basis ]

(***************************************************************************)
(* Step 5, the freeze-and-redistribute loop.                               *)
(* Fuel bounds recursion; the spec guarantees at least one freeze per round *)
(* so N+1 rounds always suffice.                                           *)
(***************************************************************************)
RECURSIVE Rounds(_, _, _, _, _)
Rounds(cfg, C, frozen, target, fuel) ==
    IF fuel = 0 \/ Cardinality(frozen) = N
    THEN target
    ELSE LET unf  == Items \ frozen
             grow == Growing(cfg, C)
             \* 5b: frozen contribute target, unfrozen contribute BASIS
             outer == Sum([ i \in Items |->
                              IF i \in frozen THEN target[i] ELSE cfg[i].basis ])
             rem == C - outer
             \* grow: factor. shrink: scaled shrink factor = shrink * basis.
             sf == [ i \in Items |->
                       IF i \in unf
                       THEN (IF grow THEN cfg[i].grow ELSE cfg[i].shrink * cfg[i].basis)
                       ELSE 0 ]
             tot == Sum(sf)
             \* 5c. Distributing zero still RESETS the target to the basis.
             raw == [ i \in Items |->
                        IF i \notin unf THEN target[i]
                        ELSE IF rem = 0 \/ tot = 0 THEN cfg[i].basis
                        ELSE IF grow THEN cfg[i].basis + (rem * sf[i]) \div tot
                        ELSE cfg[i].basis - ((0 - rem) * sf[i]) \div tot ]
             \* 5d. Clamp, then floor at zero.
             clamped == [ i \in Items |->
                            IF i \in unf
                            THEN Max2(0, Clamp(raw[i], cfg[i].min, cfg[i].max))
                            ELSE target[i] ]
             viol == [ i \in Items |-> IF i \in unf THEN clamped[i] - raw[i] ELSE 0 ]
             tv   == Sum(viol)
             \* 5e. Freeze by the sign of the TOTAL violation.
             nf == frozen \cup
                     (IF tv = 0    THEN unf
                      ELSE IF tv > 0 THEN { i \in unf : viol[i] > 0 }
                      ELSE                { i \in unf : viol[i] < 0 })
         IN Rounds(cfg, C, nf, clamped, fuel - 1)

Used(cfg, C) == Rounds(cfg, C, Step3Frozen(cfg, C), InitTarget(cfg, C), N + 1)

(***************************************************************************)
(* THE FACETS.                                                             *)
(*                                                                         *)
(* REJECTED, and kept here as record. The first attempt conditioned on      *)
(* Growing(cfg, C):                                                        *)
(*                                                                         *)
(*   Facet_ZeroFactor  == Fac(cfg,C,i) = 0                                 *)
(*   Facet_PinnedAtMin == ~Growing(cfg,C) /\ BasisBelowMin(cfg,i)          *)
(*   Facet_CappedAtMax == Growing(cfg,C)  /\ BasisAboveMax(cfg,i)          *)
(*                                                                         *)
(* TLC refuted this in 2 seconds. Counterexample:                          *)
(*   item1 basis 0 grow 0 shrink 0                                         *)
(*   item2 basis 0 grow 0 shrink 0                                         *)
(*   item3 basis 60 grow 0 shrink 1   <- item under test                   *)
(* OuterHypSum is 60, so every width is in GROW mode, item3 has grow 0, and *)
(* Facet_ZeroFactor admits it. But raising item1's basis to 120 makes the   *)
(* sum 180, which flips width 120 into SHRINK mode, where item3's governing *)
(* factor is shrink = 1 rather than grow = 0. It unfreezes and moves.       *)
(*                                                                         *)
(* LESSON: Growing(cfg, C) is NOT a safe container-level fact. It sums      *)
(* every item's hypothetical size, so a sibling can flip it. Any facet      *)
(* conditioned on the mode inherits sibling dependence.                     *)
(*                                                                         *)
(* CURRENT CANDIDATE. Facets must hold regardless of mode, so they may not  *)
(* mention Growing at all. These reference only item i's own properties,    *)
(* which makes them both sibling-independent and width-independent.         *)
(***************************************************************************)
(* The four facets found by exhaustive exact search over this same domain             *)
(* (sln/facet_search.py: 331,776 pairs, 0 unsound admits, 97.70% of independent).     *)
Facet_Inflexible(cfg, i)    == cfg[i].grow = 0 /\ cfg[i].shrink = 0
Facet_FixedByBounds(cfg, i) == cfg[i].max # INF /\ cfg[i].min = cfg[i].max
Facet_ShrinkFloor(cfg, i)   == cfg[i].grow = 0 /\ Hyp(cfg, i) =< cfg[i].min
Facet_GrowCeiling(cfg, i)   == cfg[i].shrink = 0 /\ cfg[i].max # INF
                                                 /\ Hyp(cfg, i) >= cfg[i].max

(***************************************************************************)
(* THE COLLAPSED FORM.                                                     *)
(*                                                                         *)
(* The four facets are not independent inventions. Every one of them says   *)
(* the same thing about a different direction of motion, and their          *)
(* disjunction is exactly this conjunction:                                 *)
(*                                                                         *)
(*   an item is admissible iff it cannot move in EITHER direction, where    *)
(*   each direction is blocked by a zero factor or by the item already      *)
(*   sitting against its own bound.                                         *)
(*                                                                         *)
(* Distributing the disjunction over the conjunction recovers the facets:   *)
(*   grow=0    /\ shrink=0        -> Facet_Inflexible                       *)
(*   grow=0    /\ basis =< min    -> Facet_ShrinkFloor                      *)
(*   basis>=max /\ shrink=0       -> Facet_GrowCeiling                      *)
(*   basis>=max /\ basis =< min   -> Facet_FixedByBounds                    *)
(*                                                                         *)
(* Note what it does NOT mention: any sibling, and the container width. The *)
(* mode is deliberately absent, because Growing(cfg,C) is sibling-dependent *)
(* (see the REJECTED note above). Width-independence is therefore free, and *)
(* the condition holds across the whole interval by construction rather     *)
(* than by checking each width.                                            *)
(***************************************************************************)
(* REFUTED BY STEP 4, kept as record. The first collapse compared the RAW basis:            *)
(*                                                                                          *)
(*   CannotGrow   == grow = 0    \/ basis >= max                                            *)
(*   CannotShrink == shrink = 0  \/ basis =< min                                            *)
(*                                                                                          *)
(* Sound and maximal on the baseline domain, gap to the ceiling exactly 0. But the baseline  *)
(* draws mins from {0,60} and maxes from {INF,120}, which never coincide, so the min = max   *)
(* case never arose. On a domain where it does, this rejects four always-independent shapes, *)
(* e.g. basis 0, grow 1, shrink 0, min 60, max 60: min = max pins the item at 60 whatever    *)
(* the siblings do, but 0 >= 60 is false so the raw-basis test says it can still grow.       *)
(*                                                                                          *)
(* The error was starting from the basis. Step 3 starts from the HYPOTHETICAL main size --   *)
(* the basis already clamped by the item's own bounds -- and step 5d re-clamps to those same *)
(* bounds every round. So the question is where Hyp sits relative to the bounds, not where   *)
(* the basis does. Hyp is defined above from cfg[i] alone, so this stays item-local.         *)
CannotGrow(cfg, i)   == cfg[i].grow = 0
                        \/ (cfg[i].max # INF /\ Hyp(cfg, i) >= cfg[i].max)
CannotShrink(cfg, i) == cfg[i].shrink = 0 \/ Hyp(cfg, i) =< cfg[i].min

Immobile(cfg, i) == CannotGrow(cfg, i) /\ CannotShrink(cfg, i)

Candidate(cfg, C, i) == Immobile(cfg, i)

CandidateAcross(cfg, i) == \A C \in Widths : Candidate(cfg, C, i)

(* Sanity: the collapsed form and the facet disjunction are the same predicate. *)
CollapseAgreesAt(c, i) ==
    Immobile(c, i) <=> (\/ Facet_Inflexible(c, i)
                        \/ Facet_FixedByBounds(c, i)
                        \/ Facet_ShrinkFloor(c, i)
                        \/ Facet_GrowCeiling(c, i))

(***************************************************************************)
(* GROUND TRUTH inside the model. Product construction: item i is           *)
(* independent at width C if its used size is unchanged under every         *)
(* admissible change to any SIBLING's flex base size.                       *)
(***************************************************************************)
Variants(cfg, i) == { [cfg EXCEPT ![j].basis = b] : j \in Items \ {i}, b \in Bases }

IndependentAt(cfg, C, i) ==
    \A alt \in Variants(cfg, i) : Used(alt, C)[i] = Used(cfg, C)[i]

IndependentAcross(cfg, i) == \A C \in Widths : IndependentAt(cfg, C, i)

(***************************************************************************)
(* Exploration harness. TLC enumerates every (config, item) pair as an      *)
(* initial state and checks the invariant. There is no temporal behaviour;  *)
(* the state space IS the configuration space.                              *)
(***************************************************************************)
VARIABLES cfg, item
vars == << cfg, item >>

Init == cfg \in Config /\ item \in Items
Next == UNCHANGED vars
Spec == Init /\ [][Next]_vars

TypeOK == cfg \in Config /\ item \in Items

(* The collapsed predicate and the four named facets denote the same set. *)
CollapseAgrees == \A i \in Items : CollapseAgreesAt(cfg, i)

(* SOUNDNESS. Never admit a coupled item. A counterexample kills the        *)
(* candidate condition.                                                     *)
Sound == CandidateAcross(cfg, item) => IndependentAcross(cfg, item)

(* COMPLETENESS, stated as a deliberately FALSE invariant so that TLC       *)
(* prints a witness: an item that IS independent but the condition misses.  *)
(* Each counterexample names a facet we have not yet written down.          *)
Complete == IndependentAcross(cfg, item) => CandidateAcross(cfg, item)

=============================================================================
