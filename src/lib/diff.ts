/* SPDX-License-Identifier: LGPL-2.1-or-later */

export type DiffLine = { type: "context" | "add" | "remove" | "skip"; text: string };

// The LCS table is O(n*m); beyond this the diff degrades to remove-all/add-all.
const MAX_LCS_CELLS = 2_000_000;

const splitLines = (text: string): string[] => {
    if (text === "")
        return [];
    const lines = text.split("\n");
    if (lines[lines.length - 1] === "")
        lines.pop();
    return lines;
};

function diffLines(before: string[], after: string[]): DiffLine[] {
    // Trim the common prefix and suffix, which is most of a typical edit.
    let start = 0;
    while (start < before.length && start < after.length && before[start] === after[start])
        start++;
    let endBefore = before.length;
    let endAfter = after.length;
    while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) {
        endBefore--;
        endAfter--;
    }

    const a = before.slice(start, endBefore);
    const b = after.slice(start, endAfter);
    const middle: DiffLine[] = [];
    if ((a.length + 1) * (b.length + 1) > MAX_LCS_CELLS) {
        middle.push(...a.map(text => ({ type: "remove" as const, text })));
        middle.push(...b.map(text => ({ type: "add" as const, text })));
    } else {
        const width = b.length + 1;
        const table = new Uint32Array((a.length + 1) * width);
        for (let i = a.length - 1; i >= 0; i--) {
            for (let j = b.length - 1; j >= 0; j--) {
                table[i * width + j] = a[i] === b[j]
                    ? table[(i + 1) * width + j + 1] + 1
                    : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
            }
        }
        let i = 0;
        let j = 0;
        while (i < a.length || j < b.length) {
            if (i < a.length && j < b.length && a[i] === b[j]) {
                middle.push({ type: "context", text: a[i] });
                i++;
                j++;
            } else if (i < a.length && (j === b.length || table[(i + 1) * width + j] >= table[i * width + j + 1])) {
                // Prefer removals on ties so a replaced line reads "- old, + new".
                middle.push({ type: "remove", text: a[i] });
                i++;
            } else {
                middle.push({ type: "add", text: b[j] });
                j++;
            }
        }
    }

    return [
        ...before.slice(0, start).map(text => ({ type: "context" as const, text })),
        ...middle,
        ...before.slice(endBefore).map(text => ({ type: "context" as const, text })),
    ];
}

/**
 * Line diff of two texts with unchanged runs collapsed to `context` lines
 * around each change.
 */
export function diffTexts(before: string, after: string, context = 3): DiffLine[] {
    const lines = diffLines(splitLines(before), splitLines(after));
    const keep = new Array<boolean>(lines.length).fill(false);
    lines.forEach((line, index) => {
        if (line.type === "context")
            return;
        for (let k = Math.max(0, index - context); k <= Math.min(lines.length - 1, index + context); k++)
            keep[k] = true;
    });

    const result: DiffLine[] = [];
    let skipped = 0;
    lines.forEach((line, index) => {
        if (keep[index]) {
            if (skipped) {
                result.push({ type: "skip", text: `${skipped} unchanged line${skipped === 1 ? "" : "s"}` });
                skipped = 0;
            }
            result.push(line);
        } else {
            skipped++;
        }
    });
    if (skipped && result.length)
        result.push({ type: "skip", text: `${skipped} unchanged line${skipped === 1 ? "" : "s"}` });
    return result;
}
