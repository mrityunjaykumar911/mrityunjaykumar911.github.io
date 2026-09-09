----------------------------- MODULE GateCatalog -----------------------------
EXTENDS Naturals

\* This is the executable truth-table definition, not a JavaScript enumeration.
\* Each of the 256 Boolean valuations is an initial state. The text dump includes
\* TLC's computed decision. The bit order is part of the runtime interface:
\* checksPassed, inventoryComplete, revisionMatches, policyMatches,
\* attemptMatches, notCancelled, notReleased, ticketMatches.
VARIABLES checksPassed, inventoryComplete, revisionMatches, policyMatches,
          attemptMatches, notCancelled, notReleased, ticketMatches, allowed

vars == <<checksPassed, inventoryComplete, revisionMatches, policyMatches,
          attemptMatches, notCancelled, notReleased, ticketMatches, allowed>>

\* ReleaseGate instantiates this same operator. Runtime callers must compute
\* these facts from authoritative state at commit, not reuse prepare-time facts.
Gate(f) ==
    /\ f.checksPassed
    /\ f.inventoryComplete
    /\ f.revisionMatches
    /\ f.policyMatches
    /\ f.attemptMatches
    /\ f.notCancelled
    /\ f.notReleased
    /\ f.ticketMatches

Init ==
    /\ checksPassed \in BOOLEAN
    /\ inventoryComplete \in BOOLEAN
    /\ revisionMatches \in BOOLEAN
    /\ policyMatches \in BOOLEAN
    /\ attemptMatches \in BOOLEAN
    /\ notCancelled \in BOOLEAN
    /\ notReleased \in BOOLEAN
    /\ ticketMatches \in BOOLEAN
    /\ allowed = Gate([
        checksPassed |-> checksPassed,
        inventoryComplete |-> inventoryComplete,
        revisionMatches |-> revisionMatches,
        policyMatches |-> policyMatches,
        attemptMatches |-> attemptMatches,
        notCancelled |-> notCancelled,
        notReleased |-> notReleased,
        ticketMatches |-> ticketMatches])

Next == UNCHANGED vars

CatalogWellTyped ==
    /\ \A value \in {checksPassed, inventoryComplete, revisionMatches,
                    policyMatches, attemptMatches, notCancelled,
                    notReleased, ticketMatches, allowed} : value \in BOOLEAN
    /\ allowed = (checksPassed /\ inventoryComplete /\ revisionMatches
                  /\ policyMatches /\ attemptMatches /\ notCancelled
                  /\ notReleased /\ ticketMatches)
=============================================================================