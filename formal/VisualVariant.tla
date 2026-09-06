---------------------------- MODULE VisualVariant ----------------------------
EXTENDS Integers

Bodies == {12, 13, 14, 15, 16}
Heads  == {20, 25, 30, 35, 40, 45, 50}
Folds  == {40, 60, 80, 100, 120, 140, 160, 180, 200}
Spaces == {4, 6, 8}

VARIABLES body, head, fold, space
vars == <<body, head, fold, space>>

TypeOK ==
  /\ body \in Bodies
  /\ head \in Heads
  /\ fold \in Folds
  /\ space \in Spaces

Admissible ==
  /\ body >= 13
  /\ head >= 25 /\ head <= 45
  /\ fold >= 40 /\ fold <= 120
  /\ space \in {4, 8}

Safety == TypeOK /\ Admissible

Init ==
  /\ body = 15
  /\ head = 40
  /\ fold = 100
  /\ space = 8

SetBody ==
  /\ \E v \in Bodies : v >= 13 /\ body' = v
  /\ UNCHANGED <<head, fold, space>>

SetHead ==
  /\ \E v \in Heads : v >= 25 /\ v <= 45 /\ head' = v
  /\ UNCHANGED <<body, fold, space>>

SetFold ==
  /\ \E v \in Folds : v >= 40 /\ v <= 120 /\ fold' = v
  /\ UNCHANGED <<body, head, space>>

SetSpace ==
  /\ \E v \in Spaces : (v = 4 \/ v = 8) /\ space' = v
  /\ UNCHANGED <<body, head, fold>>

SafeNext == SetBody \/ SetHead \/ SetFold \/ SetSpace
SafeSpec == Init /\ [][SafeNext]_vars

ShrinkBelowLegible ==
  /\ body' = 12
  /\ UNCHANGED <<head, fold, space>>

MutantSpec == Init /\ [][SafeNext \/ ShrinkBelowLegible]_vars

=============================================================================
