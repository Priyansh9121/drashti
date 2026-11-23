import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
for(const name of ['operator-guide','admin-guide']) it(`${name} explains page cropping and original content`,()=>{
 const guide=readFileSync(resolve('docs',`${name}.md`),'utf8');
 expect(guide).toContain('**Crop page…**');
 for(const choice of ['This page','Every page','Odd pages','Even pages']) expect(guide).toContain(`**${choice}**`);
 expect(guide).toContain('CropBox');
});
