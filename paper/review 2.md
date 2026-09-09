review 2

Yes. After reading the paper, I agree with your concern: the paper has strong engineering evidence, but the central scientific claim is not yet as compelling as it could be.

The biggest issue is that the headline result—“only 28.07% of real flex containers can be compositionally certified”—is interesting, but it is not yet a sufficiently strong research claim by itself. The paper essentially establishes a ceiling for one particular local-vocabulary formulation, then concludes that layout verification is not worth the budget. That final leap is much weaker than the underlying results.

The paper itself is unusually honest about this distinction: it proves maximality only within the item-local setting, and explicitly says that closing the gap would require either a richer vocabulary or container-level facts.

The strongest way to strengthen the paper

I would change the central claim from “we found a useful predicate” to “we characterize the fundamental limits of local compositional verification for flexbox.”

That is a much stronger systems/formal-methods contribution.

Right now the paper says, roughly:

Here is the strongest local condition → it certifies 28.07% of containers → therefore layout verification has limited value.

Instead, make the thesis:

Local compositional verification of flexbox has a provable information-theoretic/structural ceiling, and the gap between that ceiling and practical certification is caused by sibling-dependent layout, not inadequate predicates.

That claim is substantially stronger because the paper already has the ingredients.

1. Turn the “28.07%” into a decomposition theorem

You currently have:

67.66% of items are independent.
45.76% of containers have every item independent.
28.07% are fully certified by the proposed condition.
The empirical ceiling is 45.76%.
The local predicate cannot close the remaining gap because of the maximality result.

This is actually more interesting than the 28.07% headline.

I would make the core result something like:

Theorem / Result:

Among real flex containers, there is a measurable gap between structural independence and locally decidable independence. This gap is not due to an insufficient predicate: maximality shows that no predicate using the current item-local vocabulary can recover the missing cases.

Then quantify:

45.76% → theoretical empirical ceiling
28.07% → actually certified
17.69 percentage points → cases requiring information outside the local vocabulary

That 17.69-point gap becomes a research object rather than an embarrassing limitation.

Even better, classify those 17.69 points.

For example:

Cause of non-locality	Fraction
Grow/shrink mode depends on siblings	X%
Container size depends on children	X%
Cross-axis coupling	X%
Intrinsic sizing / replaced elements	X%
Other	X%

The paper already identifies several of these mechanisms qualitatively.

That experiment would make the claim much more powerful.

2. Add a “what would it take to beat 28.07%?” experiment

This is probably the single strongest addition.

You currently show that the local predicate is maximal. But a skeptical reviewer can still say:

Fine. Your vocabulary is too weak. Give me a better vocabulary.

So don't just say that. Measure the price of additional information.

Construct progressively stronger recognizers:

Level 0 — item-local

current Immobile

Level 1 — item + container facts

known container main size
known grow/shrink mode
wrap status

Level 2 — limited sibling summaries

sum of hypothetical sizes
aggregate grow/shrink pressure
min/max sibling constraints

Level 3 — full sibling information

essentially run the flex resolution algorithm

Then report something like:

Information available	Certification
Item-local	28.07%
+ container facts	34.8%
+ aggregate sibling facts	42.1%
+ richer summaries	45.5%
Full sibling reasoning	45.76%

I'm not suggesting those numbers—they need to be measured.

But that curve would transform the paper.

Now the paper isn't merely:

“Our predicate gets 28%.”

It becomes:

“We quantify the information required to make flexbox compositional.”

That is a significantly better research contribution.

3. Strengthen the causal claim about why flexbox is difficult

The introduction currently makes a strong statement:

“most real flex containers are genuinely coupled, not because nobody has written the rules down.”

That is an excellent thesis, but the paper doesn't quite prove the causal story.

Add a structural taxonomy of coupling.

For every rejected container, identify the first mechanism that forces sibling dependence.

For example:

Sibling dependence
├── Free-space distribution
│   ├── grow
│   └── shrink
├── Container intrinsic sizing
├── Automatic minimum size
├── Cross-axis → main-axis coupling
├── Intrinsic aspect ratio
└── Other

Then report percentages.

That lets you make a much stronger statement:

“We don't merely observe that flexbox is difficult. We identify the mechanisms responsible for X% of failures.”

That is much more publishable.

4. Make Study B substantially more quantitative

This is where I think the paper is currently weakest.

The disclosure study finds:

reversed email missed
PDFs outside the sink enumeration

Those are compelling bugs, but from a scientific perspective it is still only one repository and two findings. The authors themselves acknowledge this: the findings show that the defect class exists, not how common it is.

A reviewer can easily say:

“Nice case study. Why should I believe this generalizes?”

Much stronger experiment: seeded mutations

Take the repository and systematically inject realistic publication bugs:

string reversal
Base64
URL encoding
HTML entity encoding
moving secrets into attributes
moving content into PDFs
adding an unenumerated sink
adding a new source
changing clearance
bypassing one assertion
introducing a new generated artifact

Then measure:

Existing tests vs your checker

For example:

Mutation	Existing tests	New checker
Reversed secret	✗	✓
Base64	✗	✓
New PDF sink	✗	✓
Undeclared source	?	✓
Wrong clearance	✗	✓

Now you have systematic evidence of defect-class coverage, rather than two anecdotes.

That would make Study B much harder to dismiss.

5. Introduce a baseline

This is surprisingly important.

The paper compares your checker to essentially the existing hand-written test system, but not to alternative approaches.

For geometry, compare against:

naive syntactic heuristic
browser-based perturbation testing
full recomputation
your maximal local predicate

You already have one interesting baseline buried in the paper:

a previous syntactic proxy reported only 1.1% decomposability, while the semantic condition gets 28.07%.

Promote that into a proper baseline experiment.

That gives you a very strong narrative:

Syntax says 1.1%
Semantic local reasoning says 28.07%
Theoretical empirical ceiling is 45.76%

That three-stage progression is excellent.

6. Separate “soundness” from “usefulness” more explicitly

One subtle weakness is that the paper spends a lot of rhetorical energy on:

100% precision

But because the predicate is intentionally conservative, a trivial checker that certifies nothing also has 100% precision.

You partially address this with maximality, which is good. But make this formal.

Define:

$$ \text{Utility} = f(\text{soundness}, \text{coverage}, \text{cost}) $$

Then compare:

Method	Precision	Recall	Cost
Empty checker	100%	0%	trivial
Syntax heuristic	...	...	...
Your predicate	100%	78.15%	...
Full browser analysis	...	100%	...

That makes the argument much more rigorous.

7. Quantify the cost/benefit claim

The conclusion currently says:

“Spend it on enumerating sinks and labelling sources. Do not spend it on proving layout compositionally.”

This is too broad for the evidence currently presented.

You have evidence that:

disclosure checking is cheap (<10 sec)
it catches defects
geometric certification is limited to 28.07% of containers.

But you have not really measured the engineering cost of each verification strategy.

Add something like:

$$ \text{verification benefit} = \frac{\text{defects detected}}{\text{runtime + engineering complexity}} $$

Even a simple empirical analysis would strengthen this dramatically.

For example:

developer effort
implementation LOC
runtime
maintenance burden
defects found
coverage

Then the final recommendation becomes evidence-based instead of rhetorical.

8. One particularly strong experiment: cross-site replication

This is probably the best way to defeat the “single artifact” criticism in Study B.

Study A already uses 1,200 pages.

Do something similar for disclosure:

10–50 independent static sites / repositories

Run the sink checker and report:

repositories analyzed
sinks per repository
violations
unknown/unclassified sinks
manual-policy decisions
false positives
false negatives

Even a modest corpus would massively upgrade the paper.

The current paper explicitly admits:

“Study B is a single artifact.”

That is exactly the kind of sentence a reviewer will circle.

9. Turn the self-found defects into a methodological contribution

The five instrument/model defects are actually quite valuable.

But right now they're presented mostly as honesty/calibration.

I'd make them into a formal contribution:

Verification infrastructure itself requires verification.

Then classify them:

Defect	Detection mechanism	Would normal evaluation catch it?
Content-sized container	differential probe	No
Cross-axis coupling	differential probe	No
CSS transition interference	sentinel test	No
Vacuous mutation	mutation testing	No
Tautological invariant	semantic mutation	No

The paper's most interesting methodological insight may actually be:

A verification result is not trustworthy merely because the checker is formally specified; the measurement boundary itself must be adversarially validated.

That is a strong broader lesson.

What I would make the new central claim

I would rewrite the paper around something like this:

The limits of compositional web verification are not primarily a matter of insufficient rules, but of insufficient information.

For flexbox, we characterize the strongest independence condition expressible from item-local information and prove it maximal. On 1,200 real pages, this condition certifies 28.07% of flex containers; a larger empirical ceiling of 45.76% is reachable only when information unavailable to the local contract is exposed. We identify the structural sources of this gap and quantify the additional information required to recover it. In contrast, artifact-level information-flow checking provides near-complete, low-cost coverage of the publication policy and exposes defects that representation-based tests miss.

That is much stronger than “we have two contract classes and the practical conclusion is asymmetric.”

My priority ranking

If you only have time for three major changes, I'd do:

#1 — Information ladder experiment
Measure how certification changes as you add container/sibling information.

#2 — Coupling taxonomy
Explain exactly why the remaining 72% cannot be decomposed locally.

#3 — Mutation campaign for disclosure
Turn the two real bugs into systematic evidence against the existing test methodology.

Those three changes would turn the paper from:

“Here is a clever predicate + two bugs”

into:

“We experimentally and theoretically characterize the information boundary of compositional verification for web artifacts.”

That is a much stronger paper-level claim, and importantly, it is already latent in the results you have rather than requiring an entirely new research direction.