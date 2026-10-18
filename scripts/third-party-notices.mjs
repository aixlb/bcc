/** Preserve legal notices for the packages actually inlined by esbuild. */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const GENERATED_START = '<!-- BEGIN GENERATED BUNDLED DEPENDENCY NOTICES -->'
const GENERATED_END = '<!-- END GENERATED BUNDLED DEPENDENCY NOTICES -->'
const NOTICE_NAME = /^(?:licen[cs]e|copying|notice|copyright)(?:$|[._-].*)/i
// Version-specific upstream snapshots cover legal files omitted from npm tarballs.
// Kept here so ordinary builds are offline and produce identical notices.
const UPSTREAM_NOTICES = /* UPSTREAM_NOTICE_SNAPSHOTS */ {
  "saxes@5.0.1": {
    "name": "LICENSE (upstream snapshot)",
    "source": "https://raw.githubusercontent.com/lddubeau/saxes/v5.0.1/LICENSE",
    "text": "The ISC License\n\nCopyright (c) Contributors\n\nPermission to use, copy, modify, and/or distribute this software for any\npurpose with or without fee is hereby granted, provided that the above\ncopyright notice and this permission notice appear in all copies.\n\nTHE SOFTWARE IS PROVIDED \"AS IS\" AND THE AUTHOR DISCLAIMS ALL WARRANTIES\nWITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF\nMERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR\nANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES\nWHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN\nACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR\nIN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.\n\n====\n\nThe following license is the one that governed sax, from which saxes\nwas forked. Isaac Schlueter is not *directly* involved with saxes so\ndon't go bugging him for saxes issues.\n\nThe ISC License\n\nCopyright (c) Isaac Z. Schlueter and Contributors\n\nPermission to use, copy, modify, and/or distribute this software for any\npurpose with or without fee is hereby granted, provided that the above\ncopyright notice and this permission notice appear in all copies.\n\nTHE SOFTWARE IS PROVIDED \"AS IS\" AND THE AUTHOR DISCLAIMS ALL WARRANTIES\nWITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF\nMERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR\nANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES\nWHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN\nACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR\nIN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.\n\n====\n\n`String.fromCodePoint` by Mathias Bynens is no longer used, but it can\nstill be found in old commits. It was once used according to terms of\nMIT License, as follows:\n\n    Copyright Mathias Bynens <https://mathiasbynens.be/>\n\n    Permission is hereby granted, free of charge, to any person obtaining\n    a copy of this software and associated documentation files (the\n    \"Software\"), to deal in the Software without restriction, including\n    without limitation the rights to use, copy, modify, merge, publish,\n    distribute, sublicense, and/or sell copies of the Software, and to\n    permit persons to whom the Software is furnished to do so, subject to\n    the following conditions:\n\n    The above copyright notice and this permission notice shall be\n    included in all copies or substantial portions of the Software.\n\n    THE SOFTWARE IS PROVIDED \"AS IS\", WITHOUT WARRANTY OF ANY KIND,\n    EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF\n    MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND\n    NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE\n    LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION\n    OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION\n    WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE."
  },
  "standardwebhooks@1.0.0": {
    "name": "LICENSE (upstream snapshot)",
    "source": "https://raw.githubusercontent.com/standard-webhooks/standard-webhooks/929bf0c1928b188287eaf88d0a9f0a4e87df6499/libraries/LICENSE",
    "text": "The MIT License\n\nCopyright (c) 2023 Svix (https://www.svix.com)\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\nof this software and associated documentation files (the \"Software\"), to deal\nin the Software without restriction, including without limitation the rights\nto use, copy, modify, merge, publish, distribute, sublicense, and/or sell\ncopies of the Software, and to permit persons to whom the Software is\nfurnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in\nall copies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED \"AS IS\", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR\nIMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,\nFITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE\nAUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER\nLIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,\nOUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN\nTHE SOFTWARE."
  },
  "buffers@0.1.1": {
    "name": "debian/copyright (historical distribution record)",
    "source": "https://sources.debian.org/data/main/n/node-buffers/0.1.1-2/debian/copyright",
    "note": "Historical Debian distribution record for the same upstream version, preserved verbatim. The npm tarball omits a standalone license file.",
    "text": "Format: http://www.debian.org/doc/packaging-manuals/copyright-format/1.0/\nUpstream-Name: buffers\nUpstream-Contact: James Halliday <mail@substack.net> (http://substack.net)\nSource: https://github.com/substack/node-buffers\n\nFiles: *\nCopyright: 2015 James Halliday <mail@substack.net> (http://substack.net)\nComment: License from package.json in upstream repo:\n https://github.com/substack/node-buffers/commit/1b745ee35d33eb166e15ef1866073a07c6d7de87\nLicense: MIT\n\nFiles: debian/*\nCopyright: 2015 Bas Couwenberg <sebastic@xs4all.nl>\n\t   2017 Ying-Chun Liu (PaulLiu) <paulliu@dt42.io>\nLicense: MIT\n\nLicense: MIT\n Permission is hereby granted, free of charge, to any person obtaining a copy\n of this software and associated documentation files (the \"Software\"), to deal\n in the Software without restriction, including without limitation the rights\n to use, copy, modify, merge, publish, distribute, sublicense, and/or sell\n copies of the Software, and to permit persons to whom the Software is\n furnished to do so, subject to the following conditions:\n .\n The above copyright notice and this permission notice shall be included in\n all copies or substantial portions of the Software.\n .\n THE SOFTWARE IS PROVIDED \"AS IS\", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR\n IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,\n FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE\n AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER\n LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,\n OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN\n THE SOFTWARE."
  },
  "chainsaw@0.1.0": {
    "name": "debian/copyright (historical distribution record)",
    "source": "https://sources.debian.org/data/main/n/node-chainsaw/0.1.0-1/debian/copyright",
    "note": "Historical Debian distribution record for the same upstream version, preserved verbatim. The npm tarball omits a standalone license file.",
    "text": "Format: http://www.debian.org/doc/packaging-manuals/copyright-format/1.0/\nSource: http://search.npmjs.org/#/chainsaw\n\nFiles: *\nCopyright: ©, James Halliday <mail@substack.net>\nLicense: MIT\n\nFiles: debian/*\nCopyright: © 2012, David Paleino <dapal@debian.org>\nLicense: MIT\n\nLicense: MIT\n Permission is hereby granted, free of charge, to any person obtaining a \n copy of this software and associated documentation files (the \n \"Software\"), to deal in the Software without restriction, including \n without limitation the rights to use, copy, modify, merge, publish, \n distribute, sublicense, and/or sell copies of the Software, and to \n permit persons to whom the Software is furnished to do so, subject to \n the following conditions:\n .\n The above copyright notice and this permission notice shall be included \n in all copies or substantial portions of the Software.\n .\n THE SOFTWARE IS PROVIDED \"AS IS\", WITHOUT WARRANTY OF ANY KIND, EXPRESS \n OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF \n MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. \n IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY \n CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, \n TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE \n SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.\n .\n Except as contained in this notice, the name(s) of the above copyright \n holders shall not be used in advertising or otherwise to promote the \n sale, use or other dealings in this Software without prior written \n authorization."
  }
}
// Keep legal wording intact while normalizing platform line endings/line tails.
const normalize = (text) => text.replace(/\r\n?/g, '\n').replace(/[\t ]+$/gm, '')
const compare = (left, right) => left < right ? -1 : left > right ? 1 : 0
// This legacy npm release has no full text and its upstream repository is gone.
// Preserve its actual declaration without inventing copyright or license text.
const DECLARATION_ONLY = new Set(['binary@0.3.0'])

function findPackage(input, root) {
  let directory = dirname(resolve(root, input))
  while (directory.replaceAll('\\', '/').includes('/node_modules/')) {
    const manifestPath = join(directory, 'package.json')
    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
      // Some packages have a type-only package.json inside dist/ or lib/.
      if (manifest.name && manifest.version) return { directory, manifest }
    }
    directory = dirname(directory)
  }
  throw new Error(`Cannot identify the bundled dependency for ${input}`)
}

function readNotices(directory) {
  const files = readdirSync(directory, { withFileTypes: true })
  const notices = files
    .filter((entry) => entry.isFile() && NOTICE_NAME.test(entry.name))
    .map((entry) => ({
      name: entry.name,
      text: normalize(readFileSync(join(directory, entry.name), 'utf8')).trimEnd(),
    }))
    .sort((left, right) => compare(left.name, right.name))
  if (notices.length) return notices

  // A few published packages place their complete license in README instead.
  for (const entry of files.filter((file) => file.isFile() && /^readme(?:$|\.)/i.test(file.name))) {
    const readme = normalize(readFileSync(join(directory, entry.name), 'utf8'))
    const heading = /(?:^|\n)(?:#{1,6}\s+license\s*\n|license\s*\n[-=]+\s*\n)/i.exec(readme)
    if (!heading) continue
    const text = readme.slice(heading.index).trim()
    if (/copyright/i.test(text) && /permission is hereby granted/i.test(text)) {
      return [{ name: `${entry.name} (License section)`, text }]
    }
  }
  return []
}

function fencedText(text) {
  text = normalize(text)
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length))
  const fence = '`'.repeat(Math.max(3, longest + 1))
  return `${fence}text\n${text}\n${fence}`
}

export function writeThirdPartyNotices(metafile, root = process.cwd()) {
  const packagesByDirectory = new Map()
  const bundledInputs = new Set(Object.values(metafile.outputs).flatMap((output) =>
    Object.entries(output.inputs)
      .filter(([, contribution]) => contribution.bytesInOutput > 0)
      .map(([input]) => input)
  ))
  for (const input of [...bundledInputs].sort(compare)) {
    if (!input.replaceAll('\\', '/').split('/').includes('node_modules')) continue
    const dependency = findPackage(input, root)
    if (!packagesByDirectory.has(dependency.directory)) {
      packagesByDirectory.set(dependency.directory, {
        ...dependency.manifest,
        notices: readNotices(dependency.directory),
      })
    }
  }

  const packagesByIdentity = new Map()
  const missing = []
  for (const dependency of packagesByDirectory.values()) {
    const identity = `${dependency.name}@${dependency.version}`
    if (!dependency.notices.length && UPSTREAM_NOTICES[identity]) {
      dependency.notices = [UPSTREAM_NOTICES[identity]]
    }
    if (!dependency.notices.length && DECLARATION_ONLY.has(identity)) {
      dependency.warning = 'The published npm tarball contains no standalone license text, and the original repository is unavailable. The original package metadata is preserved below; no missing copyright or license wording has been inferred.'
      const metadata = Object.fromEntries(['name', 'version', 'license', 'licenses', 'author', 'repository']
        .filter((field) => dependency[field] !== undefined)
        .map((field) => [field, dependency[field]]))
      dependency.notices = [{
        name: 'package.json (original license metadata)',
        source: `https://registry.npmjs.org/${dependency.name}/${dependency.version}`,
        text: JSON.stringify(metadata, null, 2),
      }]
      console.warn(`[third-party-notices] ${identity}: full upstream license text is absent; preserving its published metadata with an explicit notice`)
    }
    if (!dependency.notices.length) missing.push(identity)
    const previous = packagesByIdentity.get(identity)
    if (previous && JSON.stringify(previous.notices) !== JSON.stringify(dependency.notices)) {
      throw new Error(`Bundled copies of ${identity} contain different legal notices`)
    }
    packagesByIdentity.set(identity, dependency)
  }
  if (missing.length) {
    throw new Error(`Missing LICENSE/LICENCE/COPYING/NOTICE/COPYRIGHT files for bundled packages: ${missing.sort(compare).join(', ')}`)
  }

  const sections = [...packagesByIdentity.entries()]
    .sort(([left], [right]) => compare(left, right))
    .map(([identity, dependency]) => {
      const declared = typeof dependency.license === 'string' ? dependency.license : 'See the notices below'
      const notices = dependency.notices.map((notice) =>
        `#### ${notice.name}\n\n${notice.source ? `Source: ${notice.source}\n\n` : ''}${notice.note ? `${notice.note}\n\n` : ''}${fencedText(notice.text)}`
      ).join('\n\n')
      return `### ${identity}\n\nDeclared license: ${declared}\n\n${dependency.warning ? `**Incomplete upstream notice:** ${dependency.warning}\n\n` : ''}${notices}`
    })

  const rootNoticePath = join(root, 'THIRD_PARTY_NOTICES.md')
  // Keep the manually maintained methodology attribution above the marker.
  const introduction = normalize(readFileSync(rootNoticePath, 'utf8'))
    .split(GENERATED_START)[0].trimEnd()
  const content = `${introduction}\n\n${GENERATED_START}\n\n## Bundled JavaScript dependencies\n\nGenerated by scripts/build-skill.mjs from esbuild's actual bundled inputs. The following texts are copied from each package's distributed legal notice files.\n\n${sections.join('\n\n')}\n\n${GENERATED_END}\n`
  writeFileSync(rootNoticePath, content)
  writeFileSync(join(root, 'skills/bcc/THIRD_PARTY_NOTICES.md'), content)
  return packagesByIdentity.size
}
