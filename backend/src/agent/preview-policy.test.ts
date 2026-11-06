import {expect,it} from 'vitest';
import {resolvePreviewMaxCount} from './preview-policy.ts';

it('defaults to two and accepts zero and nonnegative integer configuration',()=>{
  expect(resolvePreviewMaxCount(undefined)).toBe(2);
  for(const [input,expected] of [[0,0],['0',0],[' 2 ',2],[3,3],['4',4]] as const)expect(resolvePreviewMaxCount(input)).toBe(expected);
});

it.each([-1,1.5,Infinity,NaN,'','-1','2.5','2e1','not-a-number',null])('rejects invalid preview count %s',value=>{
  expect(()=>resolvePreviewMaxCount(value as never)).toThrow(/PREVIEW_MAX_COUNT/);
});
