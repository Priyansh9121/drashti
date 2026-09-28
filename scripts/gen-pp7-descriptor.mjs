// Writes src/main/import/formats/pp7-descriptor.json from the vendored
// ProPresenter 7 protobuf definitions (third_party/ProPresenter7-Proto, MIT):
// for every message reachable from the documents Drashti imports, its field
// numbers, names, types and whether they repeat. The app decodes files with
// this table (src/main/import/protobuf.ts) and never loads .proto files itself.
//
//   node scripts/gen-pp7-descriptor.mjs
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import protobuf from 'protobufjs';

const here = dirname(fileURLToPath(import.meta.url));
const app = join(here, '..');
const protoDir = join(app, 'third_party', 'ProPresenter7-Proto', 'proto');
const out = join(app, 'src', 'main', 'import', 'formats', 'pp7-descriptor.json');
const protobufDir = dirname(createRequire(import.meta.url).resolve('protobufjs/package.json'));

/** The documents Drashti imports: presentations, playlists (and media/audio bins), themes. */
const ROOTS = ['rv.data.Presentation', 'rv.data.PlaylistDocument', 'rv.data.Template.Document'];

const root = new protobuf.Root();
root.resolvePath = (_origin, target) =>
  target.startsWith('google/protobuf/') ? join(protobufDir, target) : join(protoDir, target);
root.loadSync(['presentation.proto', 'propresenter.proto', 'template.proto'], { keepCase: true });
root.resolveAll();

const typeName = (t) => t.fullName.replace(/^\./u, '');
const messages = {};
const queue = [...ROOTS];
while (queue.length > 0) {
  const name = queue.shift();
  if (messages[name]) continue;
  const type = root.lookupType(name);
  const fields = {};
  for (const f of type.fieldsArray) {
    const field = { name: f.name };
    if (f instanceof protobuf.MapField) {
      field.kind = 'map';
      field.key = f.keyType;
      if (f.resolvedType instanceof protobuf.Type) {
        field.type = typeName(f.resolvedType);
        field.value = 'message';
        queue.push(field.type);
      } else {
        field.type = f.resolvedType instanceof protobuf.Enum ? typeName(f.resolvedType) : f.type;
        field.value = f.resolvedType instanceof protobuf.Enum ? 'enum' : 'scalar';
      }
    } else if (f.resolvedType instanceof protobuf.Type) {
      field.kind = 'message';
      field.type = typeName(f.resolvedType);
      queue.push(field.type);
    } else if (f.resolvedType instanceof protobuf.Enum) {
      field.kind = 'enum';
      field.type = typeName(f.resolvedType);
    } else {
      field.kind = 'scalar';
      field.type = f.type;
    }
    if (f.repeated) field.repeated = true;
    fields[f.id] = field;
  }
  messages[name] = fields;
}

const descriptor = {
  source: 'greyshirtguy/ProPresenter7-Proto @ bf6325d (autogen-proto, ProPresenter 21.4), MIT',
  roots: ROOTS,
  messages,
};
writeFileSync(out, `${JSON.stringify(descriptor)}\n`);
console.log(`${Object.keys(messages).length} message types -> ${out}`);
