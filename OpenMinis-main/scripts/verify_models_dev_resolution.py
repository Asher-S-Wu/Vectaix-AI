#!/usr/bin/env python3
"""Precompute the models.dev stage-2 resolution index.

Background
----------
`ModelsDevAPI.resolveDevModel` has two stages. Stage 1 looks the model up in its
OWN provider (cheap: one dict hit, or a scan of <=339 entries). Stage 2 is the
cross-provider fallback that third-party relays actually hit, and it used to
re-sort all 182 provider keys, re-sort every provider's model ids, and re-run
`normalizedModelKey` over all 6,243 catalog ids -- once per model being enriched.

Time Profiler on an iPhone 11 (2026-08-11) measured that at 1,418ms of a 8,971ms
launch, 997ms of it inside `normalizedModelKey` alone, recomputing a value that
cannot change while the catalog is unchanged.

The app now builds that index once at runtime (`buildStage2Index`). This script
verifies that the grouped formulation agrees with a literal replay of the old
per-key scan, over the whole real catalog.

Why this does NOT emit a checked-in index
-----------------------------------------
It was written to, and that was measured to be the wrong trade:

* The expensive part was never the grouping pass -- that is a single linear walk
  (~3ms). The 1,418ms came from repeating that walk once per model enriched.
  Doing it once, at runtime, already recovers essentially all of it, so a
  prebuilt artifact saves only that one remaining pass.
* The registry is refreshed from the network at runtime (`loadDiskCache`), so a
  build-time index can only ever describe the BUNDLED snapshot. The runtime
  builder has to exist anyway for the refreshed case.
* A checked-in index is a second copy of a derived value. If someone updates
  models-dev-api.json without regenerating it, the two disagree silently -- and
  the failure mode is wrong model capabilities, which is exactly the class of
  bug the normalization work was undertaken to fix.

So the value here is the VERIFICATION, not an artifact. Run it whenever the
catalog is updated (`update_models_dev.sh` does so automatically).

Usage
-----
    scripts/build_models_dev_index.py            # verify the runtime formulation

Exits non-zero if the grouped index disagrees with the replayed scan on any
key, which is the invariant that makes the runtime rewrite safe.
"""

import argparse
import collections
import json
import os
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CATALOG = os.path.join(REPO, "src/ios/Resources/models-dev-api.json")


def normalized_model_key(model_id):
    """Mirror of `ModelsDevAPI.normalizedModelKey`.

    Drop the vendor/namespace path, lowercase, unify `.` and `_` to `-`.
    """
    bare = model_id.split("/")[-1]
    return bare.lower().replace(".", "-").replace("_", "-")


def effort_values(model):
    """Mirror of `ModelsDevModel.effortValues`.

    nil unless the entry declares an `effort`-type reasoning option with a
    non-empty value list. `toggle` / `budget_tokens` are different mechanisms
    and must NOT count as effort support.

    Non-string elements are dropped to match the Swift decoder, which tolerates
    the `[null,"low","medium","high"]` that sarvam-30b / sarvam-105b ship.
    """
    options = model.get("reasoning_options")
    if options is None:
        return None
    for option in options:
        if option.get("type") != "effort":
            continue
        values = [v.lower() for v in (option.get("values") or []) if isinstance(v, str)]
        if values:
            return values
    return None


def pick_winner(candidates):
    """Mirror of the stage-2 majority vote.

    `candidates` is the list in scan order: providers sorted by key, and each
    provider's model ids sorted. Among entries that declare effort tiers, the
    most commonly declared set wins; ties resolve to the first seen, which is
    what makes the result reproducible across launches.
    """
    declaring = [c for c in candidates if c["effort"] is not None]
    if not declaring:
        return candidates[0] if candidates else None

    counts = collections.Counter(tuple(c["effort"]) for c in declaring)
    winner, winner_count = None, 0
    for candidate in declaring:
        key = tuple(candidate["effort"])
        if counts[key] > winner_count:
            winner_count = counts[key]
            winner = key
    for candidate in declaring:
        if tuple(candidate["effort"]) == winner:
            return candidate
    return declaring[0]


def scan_order(registry):
    """Every catalog entry, in the exact order the old stage-2 scan walked it."""
    for provider_key in sorted(registry.keys()):
        provider = registry[provider_key]
        for model_id in sorted(provider.get("models", {}).keys()):
            yield provider_key, model_id, provider["models"][model_id]


def build_index(registry):
    """Group once by normalized id, then vote per group."""
    grouped = collections.defaultdict(list)
    for provider_key, model_id, model in scan_order(registry):
        grouped[normalized_model_key(model_id)].append(
            {"provider": provider_key, "id": model_id, "effort": effort_values(model)}
        )
    return {key: pick_winner(group) for key, group in grouped.items()}


def replay_old_scan(registry, wanted):
    """Literal replay of the pre-index code: full scan for one normalized key."""
    candidates = []
    for provider_key, model_id, model in scan_order(registry):
        if normalized_model_key(model_id) == wanted:
            candidates.append(
                {"provider": provider_key, "id": model_id, "effort": effort_values(model)}
            )
    return pick_winner(candidates)


def verify(registry, index):
    """Assert the grouped index matches the replayed scan on every key.

    This is the whole safety argument for the runtime rewrite: same winner for
    every normalized id in the catalog, so no caller can observe a difference.
    """
    mismatches = []
    for wanted in sorted(index.keys()):
        if replay_old_scan(registry, wanted) != index[wanted]:
            mismatches.append(wanted)
    return mismatches


def main():
    argparse.ArgumentParser(description=__doc__).parse_args()

    with open(CATALOG) as handle:
        registry = json.load(handle)

    providers = len(registry)
    entries = sum(len(p.get("models", {})) for p in registry.values())
    print(f"catalog: {providers} providers, {entries} model entries")

    index = build_index(registry)
    print(f"index:   {len(index)} normalized keys")

    mismatches = verify(registry, index)
    if mismatches:
        print(f"FAIL: {len(mismatches)} key(s) disagree with the old scan:")
        for key in mismatches[:20]:
            print(f"  {key}")
            print(f"    old={replay_old_scan(registry, key)}")
            print(f"    new={index[key]}")
        return 1
    print(f"verified: all {len(index)} keys match a replay of the pre-index scan")
    return 0


if __name__ == "__main__":
    sys.exit(main())
