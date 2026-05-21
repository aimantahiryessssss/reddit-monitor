// Sanity-check the intent scorer against the user's stated example and
// some obvious irrelevant posts.
import { intentScore, isHighIntent } from "../src/lib/relevance.ts";

// Wait — .ts imports won't work directly from .mjs without tsx. Use tsx.
