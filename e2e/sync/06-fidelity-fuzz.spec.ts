import type { Page } from "@playwright/test";
import { fetchEditContentSnapshot, flattenTopLevelBlockTexts } from "../helpers/api";
import {
  EDITOR_SELECTOR,
  countTopLevelBlocks,
  dragBlockToGap,
  reloadEditor,
  waitForEditorReady,
} from "../helpers/editor";
import { readSyncDebugSnapshot, waitForSyncIdle } from "../helpers/sync";
import { expect, test } from "../fixtures/sync-fixture";

/**
 * 数据保真随机测试：随机编辑（输入/拆分/合并/粘贴/拖拽/撤销/格式化/全选删除），
 * 操作间隔随机制造竞态，最终等待同步空闲后刷新，要求刷新前后编辑器 DOM 完全一致，
 * 且服务端 draft 顶层文本序与编辑器一致。
 *
 * 环境变量：
 * - FUZZ_SEEDS：逗号分隔的种子（默认 1,2,3）
 * - FUZZ_STEPS：每个种子的操作数（默认 60）
 */

const SEEDS = (process.env.FUZZ_SEEDS ?? "1,2,3")
  .split(",")
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isFinite(value));
const STEPS = Number(process.env.FUZZ_STEPS ?? 60);

function createRng(seed: number) {
  let state = seed >>> 0 || 1;
  const next = () => {
    // mulberry32
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min: number, max: number) => Math.floor(next() * (max - min + 1)) + min,
    pick: <T,>(items: T[]): T => items[Math.floor(next() * items.length)],
  };
}

type Rng = ReturnType<typeof createRng>;

/** 规范化编辑器 DOM：去掉同步身份属性与瞬态 class，只保留用户可见结构。 */
async function readCanonicalEditorHtml(page: Page): Promise<string> {
  return page.locator(EDITOR_SELECTOR).first().evaluate((editor) => {
    const clone = editor.cloneNode(true) as HTMLElement;
    const transientAttrs = [
      "data-block-id",
      "data-client-id",
      "data-sort-key",
      "data-sync-create-id",
      "blockid",
      "clientid",
      "sortkey",
      "synccreateid",
      "data-placeholder",
      "contenteditable",
      "draggable",
      "spellcheck",
      "style",
    ];
    const walk = (element: Element) => {
      for (const attr of transientAttrs) element.removeAttribute(attr);
      const keepClasses = Array.from(element.classList).filter(
        (name) =>
          !/^(ProseMirror|is-|has-|block-|selected|focus|hover|drag)/.test(name),
      );
      if (keepClasses.length > 0) element.setAttribute("class", keepClasses.join(" "));
      else element.removeAttribute("class");
      Array.from(element.children).forEach(walk);
    };
    Array.from(clone.children).forEach(walk);
    clone.querySelectorAll("br.ProseMirror-trailingBreak, img.ProseMirror-separator").forEach((node) => node.remove());
    return clone.innerHTML;
  });
}

async function readTopLevelTexts(page: Page): Promise<string[]> {
  return page.locator(EDITOR_SELECTOR).first().evaluate((editor) =>
    Array.from(editor.children)
      .map((element) => (element as HTMLElement).innerText.replace(/\s+/g, " ").trim())
      .filter((text) => text.length > 0),
  );
}

async function placeCaretInBlock(page: Page, rng: Rng, edge: "start" | "end" | "random") {
  const count = await countTopLevelBlocks(page);
  if (count === 0) return;
  const index = rng.int(0, count - 1);
  const ratio = rng.next();
  await page.locator(EDITOR_SELECTOR).first().evaluate(
    (editor, input) => {
      const block = editor.children[input.index] as HTMLElement | undefined;
      if (!block) return;
      const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
      const texts: Text[] = [];
      while (walker.nextNode()) texts.push(walker.currentNode as Text);
      const selection = window.getSelection();
      if (!selection) return;
      const range = document.createRange();
      if (texts.length === 0) {
        range.setStart(block, 0);
      } else if (input.edge === "start") {
        range.setStart(texts[0], 0);
      } else if (input.edge === "end") {
        const last = texts[texts.length - 1];
        range.setStart(last, last.length);
      } else {
        const text = texts[Math.floor(input.ratio * texts.length) % texts.length];
        range.setStart(text, Math.floor(input.ratio * (text.length + 1)) % (text.length + 1));
      }
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
    },
    { index, edge, ratio },
  );
}

async function selectAcrossBlocks(page: Page, rng: Rng) {
  const count = await countTopLevelBlocks(page);
  if (count < 2) return false;
  const from = rng.int(0, count - 2);
  const to = rng.int(from + 1, Math.min(count - 1, from + 4));
  const ratioA = rng.next();
  const ratioB = rng.next();
  await page.locator(EDITOR_SELECTOR).first().evaluate(
    (editor, input) => {
      const pickPoint = (block: Element, ratio: number): [Node, number] => {
        const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
        const texts: Text[] = [];
        while (walker.nextNode()) texts.push(walker.currentNode as Text);
        if (texts.length === 0) return [block, 0];
        const text = texts[Math.floor(ratio * texts.length) % texts.length];
        return [text, Math.floor(ratio * (text.length + 1)) % (text.length + 1)];
      };
      const start = pickPoint(editor.children[input.from], input.ratioA);
      const end = pickPoint(editor.children[input.to], input.ratioB);
      const range = document.createRange();
      range.setStart(start[0], start[1]);
      range.setEnd(end[0], end[1]);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    },
    { from, to, ratioA, ratioB },
  );
  return true;
}

function randomWord(rng: Rng): string {
  const pool = ["alpha", "beta", "同步", "数据", "gamma", "保真", "delta", "测试", "x", "长文本内容"];
  const count = rng.int(1, 3);
  return Array.from({ length: count }, () => rng.pick(pool)).join(" ");
}

type FuzzAction = {
  name: string;
  weight: number;
  run: (page: Page, rng: Rng, step: number) => Promise<void>;
};

const ACTIONS: FuzzAction[] = [
  {
    name: "type",
    weight: 8,
    run: async (page, rng) => {
      await placeCaretInBlock(page, rng, "random");
      await page.keyboard.type(randomWord(rng), { delay: rng.int(0, 8) });
    },
  },
  {
    name: "enter-split",
    weight: 5,
    run: async (page, rng) => {
      await placeCaretInBlock(page, rng, rng.pick(["start", "end", "random"] as const));
      await page.keyboard.press("Enter");
      await page.keyboard.type(randomWord(rng), { delay: 0 });
    },
  },
  {
    name: "backspace-merge",
    weight: 4,
    run: async (page, rng) => {
      await placeCaretInBlock(page, rng, "start");
      await page.keyboard.press("Backspace");
    },
  },
  {
    name: "delete-forward-merge",
    weight: 2,
    run: async (page, rng) => {
      await placeCaretInBlock(page, rng, "end");
      await page.keyboard.press("Delete");
    },
  },
  {
    name: "cross-block-delete",
    weight: 3,
    run: async (page, rng) => {
      if (await selectAcrossBlocks(page, rng)) {
        await page.keyboard.press(rng.next() < 0.5 ? "Backspace" : "Delete");
      }
    },
  },
  {
    name: "cross-block-replace",
    weight: 2,
    run: async (page, rng) => {
      if (await selectAcrossBlocks(page, rng)) {
        await page.keyboard.type(randomWord(rng), { delay: 0 });
      }
    },
  },
  {
    name: "paste-lines",
    weight: 3,
    run: async (page, rng, step) => {
      await placeCaretInBlock(page, rng, rng.pick(["end", "random"] as const));
      const lines = Array.from({ length: rng.int(2, 12) }, (_, index) => `p${step}-${index} ${randomWord(rng)}`);
      await page.evaluate(async (text) => {
        await navigator.clipboard.writeText(text);
      }, lines.join("\n"));
      await page.keyboard.press("ControlOrMeta+V");
    },
  },
  {
    name: "heading",
    weight: 2,
    run: async (page, rng, step) => {
      await placeCaretInBlock(page, rng, "end");
      await page.keyboard.press("Enter");
      await page.keyboard.type(`${"#".repeat(rng.int(1, 3))} h${step} ${randomWord(rng)}`, { delay: 0 });
    },
  },
  {
    name: "bullet-list",
    weight: 2,
    run: async (page, rng, step) => {
      await placeCaretInBlock(page, rng, "end");
      await page.keyboard.press("Enter");
      await page.keyboard.type(`- li${step} ${randomWord(rng)}`, { delay: 0 });
      if (rng.next() < 0.6) {
        await page.keyboard.press("Enter");
        await page.keyboard.type(`li${step}b`, { delay: 0 });
      }
      await page.keyboard.press("Enter");
      await page.keyboard.press("Enter");
    },
  },
  {
    name: "quote",
    weight: 1,
    run: async (page, rng, step) => {
      await placeCaretInBlock(page, rng, "end");
      await page.keyboard.press("Enter");
      await page.keyboard.type(`> q${step} ${randomWord(rng)}`, { delay: 0 });
      await page.keyboard.press("Enter");
      await page.keyboard.press("Enter");
    },
  },
  {
    name: "bold-word",
    weight: 2,
    run: async (page, rng) => {
      await placeCaretInBlock(page, rng, "random");
      await page.keyboard.press("ControlOrMeta+B");
      await page.keyboard.type(`B${rng.int(0, 99)}`, { delay: 0 });
      await page.keyboard.press("ControlOrMeta+B");
    },
  },
  {
    name: "undo",
    weight: 2,
    run: async (page, rng) => {
      const times = rng.int(1, 3);
      for (let index = 0; index < times; index += 1) await page.keyboard.press("ControlOrMeta+Z");
    },
  },
  {
    name: "redo",
    weight: 1,
    run: async (page) => {
      await page.keyboard.press("ControlOrMeta+Shift+Z");
    },
  },
  {
    name: "drag",
    weight: 3,
    run: async (page, rng) => {
      const count = await countTopLevelBlocks(page);
      if (count < 3) return;
      const source = rng.int(0, count - 1);
      let target = rng.int(0, count);
      if (target === source || target === source + 1) target = source === 0 ? count : 0;
      await dragBlockToGap(page, source, target).catch(() => {});
    },
  },
  {
    name: "select-all-delete-retype",
    weight: 1,
    run: async (page, rng, step) => {
      await page.keyboard.press("ControlOrMeta+A");
      await page.keyboard.press("Backspace");
      await page.keyboard.type(`reset${step} ${randomWord(rng)}`, { delay: 0 });
    },
  },
];

function pickAction(rng: Rng): FuzzAction {
  const total = ACTIONS.reduce((sum, action) => sum + action.weight, 0);
  let roll = rng.next() * total;
  for (const action of ACTIONS) {
    roll -= action.weight;
    if (roll <= 0) return action;
  }
  return ACTIONS[0];
}

async function waitForSettled(page: Page) {
  // 状态文案稳定为「已同步」且 debug trace 不再增长
  await waitForSyncIdle(page, { timeoutMs: 120_000, stableMs: 1500 });
  let previous = -1;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const traces = (await readSyncDebugSnapshot(page)).traces.length;
    if (traces === previous) return;
    previous = traces;
    await page.waitForTimeout(1500);
  }
}

for (const seed of SEEDS) {
  test(`数据保真随机编辑 seed=${seed}`, async ({ page, authSession, syncDocument }) => {
    test.setTimeout(600_000);
    const rng = createRng(seed);
    await waitForEditorReady(page);
    await page.keyboard.type(`seed ${seed} start`, { delay: 0 });

    const log: string[] = [];
    for (let step = 0; step < STEPS; step += 1) {
      const action = pickAction(rng);
      log.push(`${step}:${action.name}`);
      await action.run(page, rng, step);
      const pause = rng.next();
      if (pause < 0.1) {
        await page.waitForTimeout(rng.int(1500, 4000));
      } else if (pause < 0.5) {
        await page.waitForTimeout(rng.int(50, 600));
      }
    }

    await waitForSettled(page);
    const editorHtml = await readCanonicalEditorHtml(page);
    const editorTexts = await readTopLevelTexts(page);

    const server = await fetchEditContentSnapshot(authSession, syncDocument.docId);
    const serverTexts = flattenTopLevelBlockTexts(server.tree).map((text) => text.replace(/\s+/g, " ").trim());

    const debugBeforeReload = await readSyncDebugSnapshot(page);
    const verifyRepairs = debugBeforeReload.traces.filter(
      (trace) =>
        trace.event === "verify:result" &&
        Number((trace.payload as { mismatchCount?: number } | undefined)?.mismatchCount ?? 0) > 0,
    );
    if (verifyRepairs.length > 0) {
      console.log(
        `[fuzz] seed=${seed} verify 修复 ${verifyRepairs.length} 次:`,
        JSON.stringify(verifyRepairs.map((trace) => trace.payload)).slice(0, 2000),
      );
      const fs = await import("node:fs");
      const dir = test.info().outputPath("fuzz");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(`${dir}/verify-debug.json`, JSON.stringify(debugBeforeReload, null, 1));
      fs.writeFileSync(`${dir}/ops.txt`, log.join(","));
    }
    await reloadEditor(page);
    await waitForSyncIdle(page, { timeoutMs: 60_000 });
    const reloadedHtml = await readCanonicalEditorHtml(page);

    const context = `seed=${seed}\nops=${log.join(",")}`;
    if (reloadedHtml !== editorHtml) {
      const fs = await import("node:fs");
      const dir = test.info().outputPath("fuzz");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(`${dir}/before.html`, editorHtml.replace(/></g, ">\n<"));
      fs.writeFileSync(`${dir}/after.html`, reloadedHtml.replace(/></g, ">\n<"));
      fs.writeFileSync(`${dir}/debug.json`, JSON.stringify(debugBeforeReload, null, 1));
      fs.writeFileSync(`${dir}/server.json`, JSON.stringify(server.tree, null, 1));
      fs.writeFileSync(`${dir}/ops.txt`, context);
    }
    expect(reloadedHtml, `刷新后 DOM 与刷新前不一致\n${context}`).toBe(editorHtml);
    // 服务端只能可靠提取段落/标题 inline 文本；仅比较这些块的相对顺序
    const editorInlineTexts = editorTexts.filter((text) => serverTexts.includes(text));
    expect(serverTexts.filter((text) => editorTexts.includes(text)), `服务端顶层顺序不一致\n${context}`).toEqual(editorInlineTexts);
  });
}
