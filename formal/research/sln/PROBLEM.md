# Flex item independence: problem statement

Status: problem definition. No specification or code yet, on purpose.

---

## 1. What we are solving, in plain English

A web page is a tree of boxes. To verify a layout property, such as "nothing overlaps",
"nothing runs off the screen", or "no text is smaller than 12 pixels", you have to reason about
how the browser decides the size and position of every box. Doing that for a whole page at once
is slow. Published results put whole-page layout verification in the range of hours per page.

The fix is to split the page. Verify each component on its own against a small contract, then
show that the conjunction of those contracts implies the property you care about for the whole
page. This works, and it is fast, but only for the older layout model of block boxes and floats.

Modern pages use flexbox. Flexbox breaks the split. Inside a flex container, the children share
the available space. If one child's content gets wider, the browser may take space away from a
different child. So the size of child A depends on the content of child B. You cannot write a
contract for child A without mentioning child B, and once you do that, the components are no
longer independent and the split stops paying for itself.

We measured how bad this is. On 4,608 real pages, using a simple syntactic test on the authored
Cascading Style Sheets (CSS), only 1.1 percent of flex containers looked safe to split.

That test was crude, and this is the important part. It marked every item with a nonzero shrink
factor as coupled. But the real flex algorithm does something more subtle. When an item shrinks
down to its minimum size, the algorithm freezes it at that minimum and stops shrinking it
further. A frozen item's final size is its own minimum, which comes from its own content. It does
not depend on any sibling. So items we counted as coupled may in fact be independent, and this
case is common, because every flex item gets an automatic minimum size derived from its content.

So the question is not "how often does coupling occur in a corpus". It is:

> **For the flex layout algorithm, exactly when is one item's final size independent of every
> other item's content?**

Answer that precisely and you know exactly where a page can be cut into pieces that can be
verified separately. Answer it loosely and you either cut in unsound places, which breaks the
proof, or you refuse to cut in safe places, which throws away coverage.

## 2. Why this needs a proof and not more counting

Counting tells you what a corpus happens to contain. It cannot tell you what is safe. The cut
rule is the core of the verification engine, and right now it is asserted rather than derived.
It should be a theorem, for three reasons.

Soundness. If the cut rule admits a case that is not actually independent, every proof built on
it is wrong. Corpus statistics cannot catch that.

Coverage. If the true condition is weaker than the syntactic test, the engine gets more
splitting, more parallel checking, and more of the page discharged by proof instead of by
sampling. The measured 1.1 percent is a lower bound produced by a conservative test, not the
real number.

Explanation. A measured percentage is a fact about a dataset. A theorem explains why modular
layout verification has not moved past floats, which is the question a reviewer will actually
ask.

## 3. The optimisation: objective, constraints, metric

We are searching for a condition C that admits flex items as independent. Not any condition. One
chosen by a stated objective under stated constraints.

**Objective, the thing we maximise.**

*Decomposable surface*: the fraction of box-tree nodes that fall inside components admitted by C.
Node-weighted, not container-counted. Verification cost scales with subtree size, so splitting a
large page section is worth far more than splitting an icon wrapper. The corpus scan reported
container counts, which was the wrong unit and will be recomputed.

**Hard constraint 1: soundness.**

Zero false admits. If C admits item i, then item i's used main size must be invariant to every
sibling's flex base size across the whole bounded domain. Soundness is not traded against
coverage at any exchange rate. A single false admit invalidates every proof built on the cut.

**Hard constraint 2: local evaluability.**

This one can kill the approach, so it is stated up front. C must be decidable from item i's own
properties plus container-level facts known before layout runs. "Item i is independent if it
freezes at its minimum" is a true statement and a useless condition, because deciding whether it
freezes means running the algorithm across all siblings, which is exactly the work we were trying
to avoid. So the target is the weakest **locally evaluable sufficient** condition, not the exact
characterisation. The exact characterisation is still worth knowing, because the gap between it
and the best local condition tells us how much coverage locality costs.

**Secondary metric: marginal gain.**

Δ = surface(C) − surface(C_syntactic), where C_syntactic is the proxy used in the corpus scan:
grow = 0 and shrink = 0 and definite basis. If Δ is near zero, the formal work bought nothing and
we report that plainly.

**Tertiary metric: evaluation cost.**

Whether C is decidable from authored CSS alone, or needs computed content sizes and therefore a
render pass. Both are usable. The price differs and belongs in the report, because it decides
where the condition can be applied in a build pipeline.

Restated in one line: **maximise decomposable surface, subject to soundness = 1 and local
evaluability, and report the gain over the syntactic baseline and the cost of evaluating C.**

## 4. Goals

G1. State the independence condition precisely, as a predicate over one item's flex properties
and the container's configuration.

G2. Get machine-checked evidence. The checker either confirms the condition holds over the
bounded domain, or returns a concrete counterexample: a specific set of items where changing one
sibling's content moves another item's box.

G3. Show the condition is not vacuous. Mutate it and require that each mutant produces the
expected counterexample, matching the discipline already used in `formal/`.

G4. Derive the cut rule from G1, so that cutting at an admitted boundary provably preserves the
whole-page property, rather than being asserted as a design choice.

G5. Re-run the corpus measurement using the true condition from G1 and report how far the
independent fraction moves from the 1.1 percent produced by the syntactic proxy. That number is
the payoff, in either direction.

## 5. Non-goals

N1. Not modelling CSS. Only the main-axis sizing of a single flex line.

N2. Not proving that any browser implements the specification correctly. We model the
specification. Connecting the model to a real rendering engine stays an executable check, the
same refinement boundary already documented in `formal/README.md`.

N3. Not an unbounded proof. The checker is exhaustive over a bounded domain: a small number of
items and discretised sizes. The claim is bounded exhaustiveness, not a general theorem. Say so
plainly wherever the result is reported.

N4. Not covering, in this first pass: multi-line wrapping, the cross axis, writing modes,
percentage bases resolved against indefinite containers, `grid`, or absolutely positioned
children.

N5. No performance or speedup claim. Whether splitting is faster is a separate question that
only becomes meaningful once the condition is known.

N6. Not building the engine. This produces one lemma the engine needs. It is not the engine.

## 6. Scope of the first model

In scope:
- one flex container with a definite main size
- one flex line, no wrapping
- items characterised by flex base size, grow factor, shrink factor, minimum size, maximum size
- the resolve-flexible-lengths loop: distribute free space by factor, clamp to minimum and
  maximum, freeze anything clamped, repeat

Out of scope for now: everything in N4.

## 7. What done looks like

A condition C such that:
- for every configuration in the bounded domain, if C holds for item i then item i's used main
  size is unchanged under any admissible change to any other item's flex base size
- the checker confirms this, and named mutants of C each produce their expected counterexample
- C admits strictly more items than the syntactic proxy used in the corpus scan, or we can
  demonstrate that it cannot
- the corpus number is recomputed under C and reported next to the original 1.1 percent

## 8. Expected outcome, stated in advance

Written down now so the result cannot be reinterpreted afterwards.

The freeze-at-minimum case should make C weaker than the syntactic proxy, so the independent
fraction should rise. If it rises a lot, the engine gets a usable sub-fragment after all and the
design changes. If it rises a little, the earlier conclusion stands and the engine's contribution
remains the sound summary of coupled containers. Both are results. Neither is a surprise we get
to spin.
