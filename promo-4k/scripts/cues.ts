// Writes the film's sound cues and length for scripts/sfx.py, straight from the timeline the picture uses.
import fs from 'node:fs';
import { CUES } from '../src/lib/story';
import { TOTAL, BGM_START } from '../src/lib/timeline';
fs.mkdirSync('out', { recursive: true });
fs.writeFileSync('out/cues.json', JSON.stringify(CUES));
fs.writeFileSync('out/meta.json', JSON.stringify({ total: TOTAL, bgmStart: BGM_START }));
console.log(`${CUES.length} cues, ${TOTAL}s, BGM from ${BGM_START}s`);
