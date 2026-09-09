---- MODULE TaskSpec ----
EXTENDS Naturals, Sequences

CONSTANTS Replay, Actions, Observed, CheckDue, CheckCategory
VARIABLES alpha, beta, doneA, doneB, due, notified, category, alphaCategory, step

ReplayActions == <<>>
ReplayObserved == <<>>
state == <<alpha, beta, doneA, doneB, due, notified, category, alphaCategory>>
vars == <<alpha, beta, doneA, doneB, due, notified, category, alphaCategory, step>>

Init == /\ alpha = 0 /\ beta = 0 /\ doneA = 0 /\ doneB = 0
        /\ due = 0 /\ notified = 0 /\ category = 0 /\ alphaCategory = 0 /\ step = 0

AddAlpha == /\ alpha' = 1
            /\ UNCHANGED <<beta, doneA, doneB, due, notified, category, alphaCategory>>
AddBeta == /\ beta' = 1
           /\ UNCHANGED <<alpha, doneA, doneB, due, notified, category, alphaCategory>>
CompleteAlpha == /\ doneA' = IF alpha = 1 THEN 1 - doneA ELSE 0
                 /\ UNCHANGED <<alpha, beta, doneB, due, notified, category, alphaCategory>>
CompleteBeta == /\ doneB' = IF beta = 1 THEN 1 - doneB ELSE 0
                /\ UNCHANGED <<alpha, beta, doneA, due, notified, category, alphaCategory>>
DeleteAlpha == /\ alpha' = 0 /\ doneA' = 0 /\ due' = 0 /\ notified' = 0 /\ alphaCategory' = 0
               /\ UNCHANGED <<beta, doneB, category>>
DeleteBeta == /\ beta' = 0 /\ doneB' = 0
              /\ UNCHANGED <<alpha, doneA, due, notified, category, alphaCategory>>
AddDueAlpha == /\ alpha' = 1 /\ due' = 1
               /\ UNCHANGED <<beta, doneA, doneB, notified, category, alphaCategory>>
WaitDue == /\ notified' = IF alpha = 1 /\ due = 1 /\ doneA = 0 THEN 1 ELSE notified
           /\ UNCHANGED <<alpha, beta, doneA, doneB, due, category, alphaCategory>>
AddCategory == /\ category' = 1
               /\ UNCHANGED <<alpha, beta, doneA, doneB, due, notified, alphaCategory>>
AddCategoryAlpha == /\ category = 1 /\ alpha' = 1 /\ alphaCategory' = 1
                    /\ UNCHANGED <<beta, doneA, doneB, due, notified, category>>

Action(name) == CASE name = "AddAlpha" -> AddAlpha
                 [] name = "AddBeta" -> AddBeta
                 [] name = "CompleteAlpha" -> CompleteAlpha
                 [] name = "CompleteBeta" -> CompleteBeta
                 [] name = "DeleteAlpha" -> DeleteAlpha
                 [] name = "DeleteBeta" -> DeleteBeta
                 [] name = "AddDueAlpha" -> AddDueAlpha
                 [] name = "WaitDue" -> WaitDue
                 [] name = "AddCategory" -> AddCategory
                 [] name = "AddCategoryAlpha" -> AddCategoryAlpha
                 [] name \in {"Blank", "Whitespace"} -> UNCHANGED state

ActionNames == {"AddAlpha", "AddBeta", "CompleteAlpha", "CompleteBeta", "DeleteAlpha", "DeleteBeta",
                "AddDueAlpha", "WaitDue", "AddCategory", "AddCategoryAlpha", "Blank", "Whitespace"}
Next == IF Replay THEN
          IF step < Len(Actions) THEN /\ Action(Actions[step + 1]) /\ step' = step + 1
          ELSE UNCHANGED vars
        ELSE /\ \E name \in ActionNames : Action(name)
             /\ UNCHANGED step

TypeOK == /\ alpha \in 0..1 /\ beta \in 0..1 /\ doneA \in 0..1 /\ doneB \in 0..1
          /\ due \in 0..1 /\ notified \in 0..1 /\ category \in 0..1 /\ alphaCategory \in 0..1 /\ step \in Nat
CompletionNeedsItem == doneA <= alpha /\ doneB <= beta
CategoryNeedsItem == alphaCategory <= alpha /\ alphaCategory <= category
ReminderNeedsItem == notified <= alpha /\ notified <= due
SnapshotMatches == IF Replay THEN
    /\ Observed[step + 1].count = alpha + beta
    /\ Observed[step + 1].alpha = alpha /\ Observed[step + 1].beta = beta
    /\ Observed[step + 1].doneA = doneA /\ Observed[step + 1].doneB = doneB
    /\ (CheckDue => (Observed[step + 1].due = due /\ Observed[step + 1].notified = notified))
    /\ (CheckCategory => (Observed[step + 1].category = category /\ Observed[step + 1].alphaCategory = alphaCategory))
    ELSE TRUE
====