# Judge alignment study

Measures how well an LLM judge (GPT-4 G-Eval) agrees with the three SummEval
expert annotators, split by how much the experts agree with each other. It
feeds section 13 of `/studies/eval-pipeline.html` and section 7.7 of the
design doc.

```sh
pip install numpy scipy krippendorff
python3 scripts/study-eval-alignment/analyze.py
```

The script downloads its inputs from pinned commits of `nlpyang/geval` and
`cambridgeltl/PairS` into `.cache/` (ignored by git), checks each file's
SHA-256, and writes `src/data/studies/eval-alignment.json`. The page reads that
file at build time, so rerunning the script and rebuilding updates every number
on the page. A run takes about four minutes, mostly the cluster bootstrap.
