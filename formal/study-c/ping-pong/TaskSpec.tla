---- MODULE TaskSpec ----
EXTENDS Naturals, Sequences

CONSTANTS Target, ExploreLimit, Replay, Actions, ObservedA, ObservedB
VARIABLES scoreA, scoreB, gameOver, step

ReplayActions == <<>>
ReplayObservedA == <<>>
ReplayObservedB == <<>>

scores == <<scoreA, scoreB, gameOver>>
vars == <<scoreA, scoreB, gameOver, step>>
Won(first, second) == first >= Target /\ first >= second + 2

Init ==
    /\ scoreA = 0
    /\ scoreB = 0
    /\ gameOver = FALSE
    /\ step = 0

PointA ==
    IF gameOver THEN UNCHANGED scores
    ELSE /\ scoreA' = scoreA + 1
         /\ UNCHANGED scoreB
         /\ gameOver' = Won(scoreA + 1, scoreB)

PointB ==
    IF gameOver THEN UNCHANGED scores
    ELSE /\ scoreB' = scoreB + 1
         /\ UNCHANGED scoreA
         /\ gameOver' = Won(scoreB + 1, scoreA)

Reset ==
    /\ scoreA' = 0
    /\ scoreB' = 0
    /\ gameOver' = FALSE

ReplayNext ==
    IF step < Len(Actions)
    THEN /\ CASE Actions[step + 1] = "A" -> PointA
              [] Actions[step + 1] = "B" -> PointB
              [] Actions[step + 1] = "Reset" -> Reset
         /\ step' = step + 1
    ELSE UNCHANGED vars

Next == IF Replay THEN ReplayNext
        ELSE (PointA \/ PointB \/ Reset) /\ UNCHANGED step

TypeOK == scoreA \in Nat /\ scoreB \in Nat /\ gameOver \in BOOLEAN /\ step \in Nat
GameOverIffWin == gameOver <=> (Won(scoreA, scoreB) \/ Won(scoreB, scoreA))
AtMostOneWinner == ~(Won(scoreA, scoreB) /\ Won(scoreB, scoreA))
WinByTwo == gameOver => (scoreA >= scoreB + 2 \/ scoreB >= scoreA + 2)
SnapshotMatches == IF Replay THEN
    scoreA = ObservedA[step + 1] /\ scoreB = ObservedB[step + 1]
    ELSE TRUE

ExplorationBound == IF Replay THEN TRUE ELSE scoreA <= ExploreLimit /\ scoreB <= ExploreLimit
====