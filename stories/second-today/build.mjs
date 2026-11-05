// Builds a playable HTML file from second-today.twee using the story format
// bundled in this repository (public/story-formats). The output mirrors what
// Twine's "Publish to File" produces (see src/util/publish.ts), so it can be
// opened directly in a browser or imported back into Twine via Library > Import.
//
// Usage: node stories/second-today/build.mjs

import {readFileSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');
const source = readFileSync(join(here, 'second-today.twee'), 'utf8');
const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));

const escape = value =>
	String(value)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');

// --- Parse Twee 3 ---------------------------------------------------------

const passages = [];

for (const chunk of source.split(/^(?=:: )/m)) {
	if (!chunk.startsWith(':: ')) continue;

	const [header, ...lines] = chunk.split(/\r?\n/);
	const match = /^::\s*(.*?)\s*(\[.*?\])?\s*(\{.*?\})?\s*$/.exec(header);

	if (!match) throw new Error(`Bad passage header: ${header}`);

	passages.push({
		name: match[1],
		tags: match[2] ? match[2].slice(1, -1).split(/\s+/).filter(Boolean) : [],
		text: lines.join('\n').replace(/\s+$/, '')
	});
}

const take = name => {
	const index = passages.findIndex(p => p.name === name);
	return index === -1 ? undefined : passages.splice(index, 1)[0];
};

const storyTitle = take('StoryTitle').text.trim();
const storyData = JSON.parse(take('StoryData').text);
const stylesheet = passages
	.filter(p => p.tags.includes('stylesheet'))
	.map(p => p.text)
	.join('\n');
const script = passages
	.filter(p => p.tags.includes('script'))
	.map(p => p.text)
	.join('\n');
const storyPassages = passages.filter(
	p => !p.tags.includes('stylesheet') && !p.tags.includes('script')
);

// --- Sanity check links ---------------------------------------------------

const names = new Set(storyPassages.map(p => p.name));
const problems = [];

for (const p of storyPassages) {
	const targets = [
		...[...p.text.matchAll(/\[\[(?:[^\]]*?->)?([^\]]+?)\]\]/g)].map(m => m[1]),
		...[...p.text.matchAll(/\(go-?to:\s*"([^"]+)"\)/g)].map(m => m[1])
	];

	for (const target of targets) {
		if (!names.has(target)) problems.push(`"${p.name}" -> "${target}"`);
	}
}

if (!names.has(storyData.start)) problems.push(`start "${storyData.start}"`);

if (problems.length > 0) {
	throw new Error(`Broken links:\n  ${problems.join('\n  ')}`);
}

// --- Load story format -----------------------------------------------------

const formatDir = `${storyData.format.toLowerCase()}-${storyData['format-version']}`;
const formatJs = readFileSync(
	join(repoRoot, 'public', 'story-formats', formatDir, 'format.js'),
	'utf8'
);
let format;

vm.runInNewContext(formatJs, {window: {storyFormat: f => (format = f)}});

// --- Publish ---------------------------------------------------------------

const columns = 6;
let startPid;

const passageData = storyPassages
	.map((p, index) => {
		const pid = index + 1;
		const left = 100 + (index % columns) * 175;
		const top = 100 + Math.floor(index / columns) * 175;

		if (p.name === storyData.start) startPid = pid;

		return (
			`<tw-passagedata pid="${pid}" name="${escape(p.name)}" ` +
			`tags="${escape(p.tags.join(' '))}" position="${left},${top}" ` +
			`size="100,100">${escape(p.text)}</tw-passagedata>`
		);
	})
	.join('');

const storyHtml =
	`<tw-storydata name="${escape(storyTitle)}" startnode="${startPid}" ` +
	`creator="Twine" creator-version="${escape(pkg.version)}" ` +
	`format="${escape(format.name)}" format-version="${escape(format.version)}" ` +
	`ifid="${escape(storyData.ifid)}" options="" tags="" ` +
	`zoom="${escape(storyData.zoom ?? 1)}" hidden>` +
	`<style role="stylesheet" id="twine-user-stylesheet" type="text/twine-css">` +
	stylesheet +
	`</style>` +
	`<script role="script" id="twine-user-script" type="text/twine-javascript">` +
	script +
	`</script>` +
	passageData +
	`</tw-storydata>`;

const output = format.source
	.replace(/{{STORY_NAME}}/g, () => escape(storyTitle))
	.replace(/{{STORY_DATA}}/g, () => storyHtml);

const outFile = join(here, 'second-today.html');

writeFileSync(outFile, output);
console.log(
	`Wrote ${outFile} (${storyPassages.length} passages, ${format.name} ${format.version})`
);
