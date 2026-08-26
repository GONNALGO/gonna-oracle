export * from '/home/kimi/work-m2-client/src/game/font';
import { drawText as od, drawTextSh as ods } from '/home/kimi/work-m2-client/src/game/font';
export const TEXTLOG = [];
export function drawText(ctx, str, x, y, scale, color, align) {
  TEXTLOG.push({ str, x, y, scale, color, align: align ?? 'left' });
  return od(ctx, str, x, y, scale, color, align);
}
export function drawTextSh(ctx, str, x, y, scale, color, align, shadow) {
  TEXTLOG.push({ str, x, y, scale, color, align: align ?? 'left' });
  return ods(ctx, str, x, y, scale, color, align, shadow);
}
