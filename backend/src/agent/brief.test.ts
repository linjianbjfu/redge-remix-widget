import { expect, it } from "vitest";
import { createBriefProvider } from "./brief.ts";
import { WIDGET_SIZES } from "../widget-contract.ts";

it("keeps the brief stable and removable without consuming user text", () => {
  const brief = createBriefProvider();
  const context = { sessionId: "session", workspaceRoot: "/", outDir: "/out" };
  const text = brief.system(context);
  expect(brief.system(context)).toBe(text);
  expect(brief.strip(`${text}\nMake a small widget`)).toBe("Make a small widget");
  expect(brief.strip("ordinary text")).toBe("ordinary text");
  for (const [size, { width, height }] of Object.entries(WIDGET_SIZES)) {
    if (size === 'fixed') continue;
    expect(text).toContain(`${size}: ${width} x ${height} CSS px`);
  }
  expect(text).toContain('/out/meta.json');
  expect(text).toContain('immediately invoked function expression (IIFE)');
  expect(text).not.toContain('window.extractWidget');
  expect(text).toContain('window.renderWidget(data)');
  expect(text).toContain("fetch('./data.json'");
  expect(text).toContain('window.widgetReady');
  expect(text).toContain('region.xpath');
  expect(text).toContain('Legacy v1/plain HTML preview has unverified live structure');
  expect(text).toContain('preserving the original forward absolute XPath');
  expect(text).toContain('Never infer global id uniqueness');
  expect(text).toContain('last(), last-child, nth-last-child');
  expect(text).not.toContain('embedded snapshot');
  expect(text).toContain('get_design_context');
  expect(text).toContain('image-text:');
  expect(text).toContain('freeform:');
  expect(text).toContain('Only-canvas content');
});

it('keeps direct generation on the fixed portrait canvas', () => {
  const text = createBriefProvider().system({sessionId:'direct',workspaceRoot:'/',outDir:'/out',fixedCanvas:true});
  expect(text).toContain('360 x 440 CSS px');
  expect(text).toContain('fixed: 360 x 440 CSS px');
  expect(text).toContain('{"size":"fixed"}');
  expect(text).toContain('This request always requires a complete widget');
  expect(text).not.toContain('choose the smallest size');
  expect(text).not.toContain('small: 160');
});

it('states the configured preview quota or disabled checks without requiring another preview',()=>{
  const context={sessionId:'preview',workspaceRoot:'/',outDir:'/out',fixedCanvas:true};
  const disabled=createBriefProvider().system({...context,previewMaxCount:0});
  expect(disabled).toContain('Browser preview is disabled');expect(disabled).not.toContain('Call it after writing all three files');
  expect(createBriefProvider().system({...context,previewMaxCount:3})).toContain('at most 3 execution attempts');
  expect(createBriefProvider().system(context)).toContain('at most 2 execution attempts');
});
