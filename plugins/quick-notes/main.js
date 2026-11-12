// 使用宿主存储，内容保存在本机。
fluxdo.on('card.load', async ctx => {
  ctx.setData('note', await ctx.api.storage.get('note') || '');
});
fluxdo.on('save', async (ctx, args) => {
  await ctx.api.storage.set('note', args.value);
});
