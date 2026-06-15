/**
 * Seed / smoke-test script.
 *
 * Runs an initial pair-discovery scan against the live exchange (public data),
 * prints the liquid universe and the top cointegrated pairs, and — if Supabase
 * env vars are present — persists the ranked set.
 *
 * Usage:
 *   npx tsx scripts/seed.ts
 *   # or, to load .env.local first (Node 18.20+/20.6+/22):
 *   node --env-file=.env.local --import tsx scripts/seed.ts
 */

// Relative imports (no path alias) so this runs under plain tsx.
import { getLiquidUniverse, fetchAlignedCloses } from "../lib/data/exchange";
import { discoverPairs } from "../lib/engine/discovery";
import { savePairs, isSupabaseConfigured } from "../lib/db/supabase";
import { config } from "../lib/config";

async function main() {
  console.log(`\n📡 Exchange: ${config.exchange}  |  quote: ${config.quoteAsset}  |  tf: ${config.timeframe}`);
  console.log(`Fetching top ${config.universeSize} liquid symbols…`);

  const universe = await getLiquidUniverse(config.universeSize);
  console.log(`Universe (${universe.length}): ${universe.join(", ")}`);

  console.log(`\nFetching ${config.lookbackBars} bars and aligning…`);
  const matrix = await fetchAlignedCloses(universe);
  console.log(`Aligned: ${matrix.symbols.length} symbols × ${matrix.timestamps.length} bars`);

  console.log(`\nRunning pair discovery…`);
  const pairs = discoverPairs(matrix);
  console.log(`Found ${pairs.length} qualifying cointegrated pairs.\n`);

  const top = pairs.slice(0, 15);
  console.table(
    top.map((p) => ({
      pair: `${p.symbol_a}/${p.symbol_b}`,
      score: p.score.toFixed(3),
      adf_p: p.adf_pvalue.toFixed(4),
      half_life: p.half_life.toFixed(1),
      hurst: p.hurst.toFixed(2),
      corr: p.correlation.toFixed(2),
      beta: p.beta.toFixed(4),
    })),
  );

  if (isSupabaseConfigured()) {
    console.log("\n💾 Supabase configured — saving pairs…");
    try {
      await savePairs(pairs);
      console.log("Saved.");
    } catch (e) {
      console.error("Save failed:", (e as Error).message);
    }
  } else {
    console.log("\n(ℹ️  Supabase not configured — skipping save. Set env vars to persist.)");
  }
}

main().catch((e) => {
  console.error("Seed failed:", e);
  process.exit(1);
});
