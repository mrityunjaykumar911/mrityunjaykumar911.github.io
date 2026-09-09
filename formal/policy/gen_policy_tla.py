#!/usr/bin/env python3
"""
Generate the TLC-checkable policy instances from policy.json.

Disclosure.tla is parameterised over an arbitrary site. This emits one wrapper
module per policy variant that fixes the constants to this site and re-exports the
spec and invariants, plus the .cfg files.

Two variants are emitted on purpose:

  PolicyCurrent  the repository as it stands. EXPECTED TO VIOLATE Safety, on the two
                 defects the artifact check found. A model that only ever passes
                 proves nothing about its own sensitivity.
  PolicyFixed    the same policy after remediation. Expected to pass, and it is this
                 one the three mutants are run against for non-vacuity.

Generating both the model and the checker's input from one file is the point: the
abstract policy and the concrete check cannot silently disagree about what the sinks
are, which is the failure mode the previous hand-maintained refinement table had.

    python gen_policy_tla.py --policy policy.json --out .
"""

import json, argparse, os


def tla_set(xs):
    return "{" + ", ".join(f'"{x}"' for x in sorted(xs)) + "}"


def tla_fn(keys, val):
    if not keys:
        return "[ x \\in {} |-> \"public\" ]"
    parts = ", ".join(f'{k} |-> {val(k)}' for k in sorted(keys))
    return "[ " + parts + " ]"


def emit(variant, P, out_dir):
    sources = {k: v for k, v in P["sources"].items() if not k.startswith("_")}
    sinks = {k: v for k, v in P["sinks"].items() if not k.startswith("_")}
    sinks = apply_flow_patch(variant, sinks)

    over = P.get("overrides", {}).get(variant, {})
    over = {k: v for k, v in over.items() if not k.startswith("_")}

    def clearance(k):
        return f'"{sinks[k]["clearance"]}"'

    def allows_pii(k):
        v = over.get(k, {}).get("allows_pii", sinks[k]["allows_pii"])
        return "TRUE" if v else "FALSE"

    decl = P.get("declassified", {}).get(variant, {})
    decl = {k: v for k, v in decl.items() if not k.startswith("_")}
    audited = [a for a in P["audited"][variant]]

    mod = f"Policy{variant.capitalize()}"
    L = []
    L.append(f"---------------------------- MODULE {mod} ----------------------------")
    L.append("(***************************************************************************)")
    L.append(f"(* Disclosure policy instance: {variant.upper():<43}*)")
    L.append("(*                                                                         *)")
    L.append("(* GENERATED from policy.json by gen_policy_tla.py. Do not hand edit; edit  *)")
    L.append("(* the policy and regenerate, so the model and the artifact checker stay    *)")
    L.append("(* instances of one description rather than two descriptions that drift.    *)")
    if variant == "current":
        L.append("(*                                                                         *)")
        L.append("(* THIS INSTANCE IS EXPECTED TO VIOLATE Safety. It encodes the repository   *)")
        L.append("(* as it actually is, including the two defects in DESIGN.md.              *)")
    L.append("(***************************************************************************)")
    L.append("EXTENDS Integers, FiniteSets")
    L.append("")
    L.append("VARIABLES mode, published, audit")
    L.append("")
    L.append("SourceC == " + tla_set(sources))
    L.append("SinkC   == " + tla_set(sinks))
    L.append("")
    L.append("SrcAudC == " + tla_fn(sources, lambda k: f'"{sources[k]["aud"]}"'))
    L.append("SrcPIIC == " + tla_fn(sources, lambda k: "TRUE" if sources[k]["pii"] else "FALSE"))
    L.append("")
    L.append("ClearanceC     == " + tla_fn(sinks, clearance))
    L.append("SinkAllowsPIIC == " + tla_fn(sinks, allows_pii))
    L.append("")
    L.append("FlowsC == " + tla_fn(sinks, lambda k: tla_set(sinks[k]["flows"])))
    L.append("DeclassedC == " + tla_fn(sinks, lambda k: tla_set(decl.get(k, []))))
    L.append("")
    L.append("AuditedC == " + tla_set(audited))
    L.append("StripsLocalC == " + ("TRUE" if P.get("strips_local", {}).get(variant, True) else "FALSE"))
    L.append("")
    L.append("D == INSTANCE Disclosure WITH")
    L.append("    Source        <- SourceC,")
    L.append("    Sink          <- SinkC,")
    L.append("    SrcAud        <- SrcAudC,")
    L.append("    SrcPII        <- SrcPIIC,")
    L.append("    Clearance     <- ClearanceC,")
    L.append("    SinkAllowsPII <- SinkAllowsPIIC,")
    L.append("    Flows         <- FlowsC,")
    L.append("    Declassed     <- DeclassedC,")
    L.append("    Audited       <- AuditedC,")
    L.append("    StripsLocal   <- StripsLocalC")
    L.append("")
    L.append("Spec    == D!SafeSpec")
    L.append("Safety  == D!Safety")
    L.append("TypeOK  == D!TypeOK")
    L.append("SinkWithinClearance      == D!SinkWithinClearance")
    L.append("PublishedSinksAreAudited == D!PublishedSinksAreAudited")
    L.append("ProdCarriesNoLocal       == D!ProdCarriesNoLocal")
    L.append("")
    L.append("=" * 77)
    open(os.path.join(out_dir, f"{mod}.tla"), "w").write("\n".join(L) + "\n")

    inv = {"mutunaudited": "PublishedSinksAreAudited",
           "mutpiiblind":  "SinkWithinClearance",
           "mutlocalleak": "ProdCarriesNoLocal"}.get(variant)
    cfgs = {f"{mod.lower()}-safe.cfg":
            (f"SPECIFICATION Spec\nINVARIANT {inv}\n" if inv
             else "SPECIFICATION Spec\nINVARIANT TypeOK\nINVARIANT Safety\n")}
    for name, body in cfgs.items():
        open(os.path.join(out_dir, name), "w").write(body)
    return mod, list(cfgs)


def build_mutants(P):
    """Policy mutants, derived from the FIXED policy by one change each.

    Spec-level mutation is vacuous here: against a policy where nothing is
    over-clearance and every sink is audited, removing a guard exposes nothing.
    The invariants are properties of the policy-artifact pair, so the mutation
    has to be applied to the policy. Each mutant targets exactly one invariant
    and must produce a counterexample.
    """
    import copy
    for v in ("mutunaudited", "mutpiiblind", "mutlocalleak"):
        P["audited"][v] = list(P["audited"]["fixed"])
        P["declassified"][v] = copy.deepcopy(P["declassified"]["fixed"])
        P["overrides"][v] = copy.deepcopy(P["overrides"].get("fixed", {}))

    # M1: forget one sink. Finding F2 as a mutant.
    P["audited"]["mutunaudited"] = [k for k in P["audited"]["fixed"] if k != "cv_pdf"]
    # M2: stop declassifying the email, i.e. believe the reversal hid it. Finding F1.
    P["declassified"]["mutpiiblind"] = {}
    # M3: delete the `import.meta.env.DEV &&` guard in resume.ts, so a prod build
    # keeps the local overlay. This is the mutation that makes ProdCarriesNoLocal
    # falsifiable at all; with the strip hard-coded it was a tautology.
    P["strips_local"]["mutunaudited"] = True
    P["strips_local"]["mutpiiblind"] = True
    P["strips_local"]["mutlocalleak"] = False
    P["_flow_patch_mutlocalleak"] = True


def apply_flow_patch(variant, sinks):
    if variant == "mutlocalleak":
        sinks = {k: dict(v) for k, v in sinks.items()}
        sinks["index_html"]["flows"] = sinks["index_html"]["flows"] + ["resume_local"]
    return sinks


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--policy", default="policy.json")
    ap.add_argument("--out", default=".")
    a = ap.parse_args()
    P = json.load(open(a.policy))
    build_mutants(P)
    for variant in ("current", "fixed", "mutunaudited", "mutpiiblind", "mutlocalleak"):
        mod, cfgs = emit(variant, P, a.out)
        print(f"wrote {mod}.tla  + {len(cfgs)} cfg: {', '.join(cfgs)}")


if __name__ == "__main__":
    main()
