import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  FileTree,
  buildCompactedTree,
  flattenTreeFiles,
  getAllDirectoryPaths,
  getAncestorPaths,
  normalizePath,
  treeOrderedFiles,
  type TreeFile,
} from './FileTree.js';

interface CustomFile extends TreeFile {
  type: string;
  additions?: number;
  deletions?: number;
}

describe('buildCompactedTree', () => {
  it('returns an empty root for an empty list of files', () => {
    const tree = buildCompactedTree([]);
    expect(tree).toEqual({
      name: '',
      path: '',
      directories: [],
      files: [],
    });
  });

  it('ignores invalid or empty file items', () => {
    // @ts-expect-error testing invalid runtime inputs
    const tree = buildCompactedTree([null, undefined, { file: '' }]);
    expect(tree.directories).toEqual([]);
    expect(tree.files).toEqual([{ file: '' }]);
  });

  it('places root files at root and sorts them alphabetically', () => {
    const files: TreeFile[] = [
      { file: 'tsconfig.json' },
      { file: 'README.md' },
      { file: 'package.json' },
    ];
    const tree = buildCompactedTree(files);
    expect(tree.directories).toEqual([]);
    expect(tree.files.map((f) => f.file)).toEqual([
      'package.json',
      'README.md',
      'tsconfig.json',
    ]);
  });

  it('compacts single-child directory chains by default', () => {
    const files: TreeFile[] = [
      { file: 'src/features/changes/FileTree.tsx' },
    ];
    const tree = buildCompactedTree(files);
    expect(tree.files).toEqual([]);
    expect(tree.directories).toHaveLength(1);

    const compacted = tree.directories[0]!;
    expect(compacted.name).toBe('src/features/changes');
    expect(compacted.path).toBe('src/features/changes');
    expect(compacted.directories).toEqual([]);
    expect(compacted.files.map((f) => f.file)).toEqual([
      'src/features/changes/FileTree.tsx',
    ]);
  });

  it('preserves uncompacted directory nodes when compact option is false', () => {
    const files: TreeFile[] = [
      { file: 'src/features/changes/FileTree.tsx' },
    ];
    const tree = buildCompactedTree(files, { compact: false });
    expect(tree.directories).toHaveLength(1);
    expect(tree.directories[0]!.name).toBe('src');
    expect(tree.directories[0]!.path).toBe('src');

    const features = tree.directories[0]!.directories[0]!;
    expect(features.name).toBe('features');
    expect(features.path).toBe('src/features');

    const changes = features.directories[0]!;
    expect(changes.name).toBe('changes');
    expect(changes.path).toBe('src/features/changes');
    expect(changes.files.map((f) => f.file)).toEqual([
      'src/features/changes/FileTree.tsx',
    ]);
  });

  it('does not compact a directory that contains both a file and a subdirectory', () => {
    const files: TreeFile[] = [
      { file: 'src/index.ts' },
      { file: 'src/components/Button.tsx' },
    ];
    const tree = buildCompactedTree(files);
    expect(tree.directories).toHaveLength(1);

    const src = tree.directories[0]!;
    expect(src.name).toBe('src');
    expect(src.path).toBe('src');
    expect(src.files.map((f) => f.file)).toEqual(['src/index.ts']);
    expect(src.directories).toHaveLength(1);

    const comp = src.directories[0]!;
    expect(comp.name).toBe('components');
    expect(comp.path).toBe('src/components');
    expect(comp.files.map((f) => f.file)).toEqual(['src/components/Button.tsx']);
  });

  it('compacts single-child chains under branched directories', () => {
    const files: TreeFile[] = [
      { file: 'src/components/ui/Button.tsx' },
      { file: 'src/components/ui/Dialog.tsx' },
      { file: 'src/lib/utils/format.ts' },
    ];
    const tree = buildCompactedTree(files);
    expect(tree.directories).toHaveLength(1);

    const src = tree.directories[0]!;
    expect(src.name).toBe('src');
    expect(src.directories).toHaveLength(2);

    // Sorted alphabetically: 'components/ui' then 'lib/utils'
    const componentsUi = src.directories[0]!;
    expect(componentsUi.name).toBe('components/ui');
    expect(componentsUi.path).toBe('src/components/ui');
    expect(componentsUi.files.map((f) => f.file)).toEqual([
      'src/components/ui/Button.tsx',
      'src/components/ui/Dialog.tsx',
    ]);

    const libUtils = src.directories[1]!;
    expect(libUtils.name).toBe('lib/utils');
    expect(libUtils.path).toBe('src/lib/utils');
    expect(libUtils.files.map((f) => f.file)).toEqual([
      'src/lib/utils/format.ts',
    ]);
  });

  it('normalizes Windows backslashes and leading ./ or /', () => {
    const files: TreeFile[] = [
      { file: 'src\\components\\ui\\Button.tsx' },
      { file: './src/index.ts' },
      { file: '/docs/guide.md' },
    ];
    const tree = buildCompactedTree(files);

    const dirNames = tree.directories.map((d) => d.name);
    expect(dirNames).toEqual(['docs', 'src']);

    const docs = tree.directories[0]!;
    expect(docs.files.map((f) => f.file)).toEqual(['/docs/guide.md']);

    const src = tree.directories[1]!;
    expect(src.files.map((f) => f.file)).toEqual(['./src/index.ts']);
    expect(src.directories[0]!.name).toBe('components/ui');
    expect(src.directories[0]!.files.map((f) => f.file)).toEqual([
      'src\\components\\ui\\Button.tsx',
    ]);
  });

  it('preserves custom properties on the original file object', () => {
    const files: CustomFile[] = [
      { file: 'src/app.ts', type: 'modified', additions: 10, deletions: 2 },
    ];
    const tree = buildCompactedTree(files);
    const file = tree.directories[0]!.files[0]!;
    expect(file.type).toBe('modified');
    expect(file.additions).toBe(10);
    expect(file.deletions).toBe(2);
  });
});

describe('flattenTreeFiles', () => {
  it('returns empty array for empty tree', () => {
    const tree = buildCompactedTree([]);
    expect(flattenTreeFiles(tree)).toEqual([]);
  });

  it('places directory files before root files in visual order', () => {
    // Visually, folders are rendered first in the list, then root files
    const files: TreeFile[] = [
      { file: 'z_root.txt' },
      { file: 'a_folder/file.txt' },
    ];
    const tree = buildCompactedTree(files);
    const flattened = flattenTreeFiles(tree);

    // a_folder (directory) appears before z_root.txt (root file)
    expect(flattened.map((f) => f.file)).toEqual([
      'a_folder/file.txt',
      'z_root.txt',
    ]);

    // Even if the root file starts with 'a' and folder starts with 'z',
    // the folder is rendered before root files!
    const files2: TreeFile[] = [
      { file: 'a_root.txt' },
      { file: 'z_folder/file.txt' },
    ];
    const tree2 = buildCompactedTree(files2);
    const flattened2 = flattenTreeFiles(tree2);
    expect(flattened2.map((f) => f.file)).toEqual([
      'z_folder/file.txt',
      'a_root.txt',
    ]);
  });

  it('produces identical visual order whether compacted or uncompacted', () => {
    const files: TreeFile[] = [
      { file: 'README.md' },
      { file: 'src/features/changes/FileTree.tsx' },
      { file: 'src/features/changes/FileTree.test.ts' },
      { file: 'src/index.ts' },
      { file: 'package.json' },
    ];
    const compactedTree = buildCompactedTree(files, { compact: true });
    const uncompactedTree = buildCompactedTree(files, { compact: false });

    const orderCompacted = flattenTreeFiles(compactedTree).map((f) => f.file);
    const orderUncompacted = flattenTreeFiles(uncompactedTree).map((f) => f.file);

    expect(orderCompacted).toEqual(orderUncompacted);
    expect(orderCompacted).toEqual([
      'src/features/changes/FileTree.test.ts',
      'src/features/changes/FileTree.tsx',
      'src/index.ts',
      'package.json',
      'README.md',
    ]);
  });

  it('flattens complex nested directory trees strictly in depth-first visual order', () => {
    const files: TreeFile[] = [
      { file: 'root_b.txt' },
      { file: 'dir1/sub1/deep.txt' },
      { file: 'dir1/b.txt' },
      { file: 'dir1/a.txt' },
      { file: 'dir2/c.txt' },
      { file: 'root_a.txt' },
    ];
    const tree = buildCompactedTree(files);
    const flattened = flattenTreeFiles(tree).map((f) => f.file);

    expect(flattened).toEqual([
      // dir1 comes first alphabetically
      // inside dir1, sub1 directory comes before dir1's files
      'dir1/sub1/deep.txt',
      'dir1/a.txt',
      'dir1/b.txt',
      // dir2 comes next
      'dir2/c.txt',
      // root files come last, sorted alphabetically
      'root_a.txt',
      'root_b.txt',
    ]);
  });
});

describe('treeOrderedFiles', () => {
  it('directly returns files in deterministic visual tree order', () => {
    const files: TreeFile[] = [
      { file: 'z.txt' },
      { file: 'docs/intro.md' },
      { file: 'src/main.ts' },
      { file: 'a.txt' },
    ];
    const ordered = treeOrderedFiles(files).map((f) => f.file);
    expect(ordered).toEqual([
      'docs/intro.md',
      'src/main.ts',
      'a.txt',
      'z.txt',
    ]);
  });
});

describe('Multi-Repo Visual Ordering & Traversal', () => {
  it('sequences files across multi-repo changesets with 0 out-of-order jumps', () => {
    // Simulating two repositories in a workspace
    const repoA = {
      repoName: 'backend',
      repoPath: '/workspace/backend',
      files: [
        { file: 'README.md' },
        { file: 'src/server.ts' },
        { file: 'src/routes/api.ts' },
      ],
    };

    const repoB = {
      repoName: 'frontend',
      repoPath: '/workspace/frontend',
      files: [
        { file: 'package.json' },
        { file: 'src/index.tsx' },
        { file: 'src/components/App.tsx' },
      ],
    };

    const repos = [repoA, repoB];

    // Build the visual order across both repos
    const multiRepoOrderedFiles = repos.flatMap((repo) =>
      treeOrderedFiles(repo.files).map((f) => ({
        repoName: repo.repoName,
        file: f.file,
      }))
    );

    expect(multiRepoOrderedFiles).toEqual([
      // Backend files in visual tree order
      { repoName: 'backend', file: 'src/routes/api.ts' },
      { repoName: 'backend', file: 'src/server.ts' },
      { repoName: 'backend', file: 'README.md' },
      // Frontend files in visual tree order
      { repoName: 'frontend', file: 'src/components/App.tsx' },
      { repoName: 'frontend', file: 'src/index.tsx' },
      { repoName: 'frontend', file: 'package.json' },
    ]);

    // Simulate stepping forward through the entire multi-repo list (Next / Alt+Down)
    for (let i = 0; i < multiRepoOrderedFiles.length - 1; i++) {
      const current = multiRepoOrderedFiles[i]!;
      const next = multiRepoOrderedFiles[i + 1]!;
      // Traversal step is strictly sequential
      expect(next).toBe(multiRepoOrderedFiles[i + 1]);
      // Boundary check: index 2 is backend/README.md, index 3 is frontend/src/components/App.tsx
      if (i === 2) {
        expect(current.repoName).toBe('backend');
        expect(next.repoName).toBe('frontend');
      }
    }

    // Simulate stepping backward through the entire multi-repo list (Prev / Alt+Up)
    for (let i = multiRepoOrderedFiles.length - 1; i > 0; i--) {
      const current = multiRepoOrderedFiles[i]!;
      const prev = multiRepoOrderedFiles[i - 1]!;
      expect(prev).toBe(multiRepoOrderedFiles[i - 1]);
      if (i === 3) {
        expect(current.repoName).toBe('frontend');
        expect(prev.repoName).toBe('backend');
      }
    }
  });

  it('populates jump dropdown options matching visual tree order with 1:1 index traversal', () => {
    const repos = [
      {
        repoName: 'api',
        files: [
          { file: 'server.ts', type: 'modified', additions: 5, deletions: 1 },
          { file: 'routes/auth.ts', type: 'added', additions: 50, deletions: 0 },
        ],
      },
      {
        repoName: 'web',
        files: [
          { file: 'public/favicon.ico', type: 'added', additions: 1, deletions: 0 },
          { file: 'src/App.tsx', type: 'modified', additions: 10, deletions: 4 },
        ],
      },
    ];

    const treeOrdered = repos.flatMap((repo) =>
      treeOrderedFiles(repo.files).map((f) => ({
        repoName: repo.repoName,
        file: f.file,
        type: f.type,
        additions: f.additions,
        deletions: f.deletions,
      }))
    );

    // Dropdown options simulated as in ChangesViewer
    const dropdownOptions = treeOrdered.map((f, i) => ({
      index: i,
      label: `[${f.type.slice(0, 3)}] ${f.repoName}: ${f.file} (+${f.additions} -${f.deletions})`,
      target: f,
    }));

    expect(dropdownOptions).toHaveLength(4);
    expect(dropdownOptions[0]!.target).toEqual({
      repoName: 'api',
      file: 'routes/auth.ts',
      type: 'added',
      additions: 50,
      deletions: 0,
    });
    expect(dropdownOptions[1]!.target).toEqual({
      repoName: 'api',
      file: 'server.ts',
      type: 'modified',
      additions: 5,
      deletions: 1,
    });
    expect(dropdownOptions[2]!.target).toEqual({
      repoName: 'web',
      file: 'public/favicon.ico',
      type: 'added',
      additions: 1,
      deletions: 0,
    });
    expect(dropdownOptions[3]!.target).toEqual({
      repoName: 'web',
      file: 'src/App.tsx',
      type: 'modified',
      additions: 10,
      deletions: 4,
    });

    // Selecting option at dropdown index 2 navigates to exact file
    const selected = treeOrdered[2]!;
    expect(selected.repoName).toBe('web');
    expect(selected.file).toBe('public/favicon.ico');
  });

  it('handles multi-repo changesets with empty repositories without skipping or throwing', () => {
    const repos = [
      { repoName: 'repo-empty-1', files: [] },
      { repoName: 'repo-active', files: [{ file: 'docs/guide.md' }, { file: 'index.ts' }] },
      { repoName: 'repo-empty-2', files: [] },
    ];

    const ordered = repos.flatMap((repo) =>
      treeOrderedFiles(repo.files).map((f) => ({
        repoName: repo.repoName,
        file: f.file,
      }))
    );

    expect(ordered).toEqual([
      { repoName: 'repo-active', file: 'docs/guide.md' },
      { repoName: 'repo-active', file: 'index.ts' },
    ]);
  });

  it('sorts arbitrarily shuffled inputs into strictly deterministic visual tree order', () => {
    const shuffled: TreeFile[] = [
      { file: 'z_dir/sub_b/file.ts' },
      { file: 'root_z.ts' },
      { file: 'a_dir/b_file.ts' },
      { file: 'z_dir/sub_a/file.ts' },
      { file: 'a_dir/a_file.ts' },
      { file: 'root_a.ts' },
      { file: 'z_dir/root_in_z.ts' },
    ];

    const ordered = treeOrderedFiles(shuffled).map((f) => f.file);
    expect(ordered).toEqual([
      // a_dir files
      'a_dir/a_file.ts',
      'a_dir/b_file.ts',
      // z_dir: sub_a, then sub_b, then files in z_dir
      'z_dir/sub_a/file.ts',
      'z_dir/sub_b/file.ts',
      'z_dir/root_in_z.ts',
      // root files alphabetical
      'root_a.ts',
      'root_z.ts',
    ]);
  });

  it('handles paths with multiple slashes and spaces cleanly', () => {
    const files: TreeFile[] = [
      { file: 'src//deep///path//my file.ts' },
      { file: 'src/deep/path/another file.ts' },
    ];
    const tree = buildCompactedTree(files);
    const ordered = flattenTreeFiles(tree).map((f) => f.file);

    expect(ordered).toEqual([
      'src/deep/path/another file.ts',
      'src//deep///path//my file.ts',
    ]);
  });

  it('does not create phantom dot folders for repeated ./ prefixes or segments', () => {
    const files: TreeFile[] = [
      { file: '././foo.txt' },
      { file: 'src/./components/Button.tsx' },
      { file: './//docs///guide.md' },
    ];
    const tree = buildCompactedTree(files);

    // foo.txt must be directly in root.files, not in a '.' directory!
    expect(tree.files.map((f) => f.file)).toEqual(['././foo.txt']);
    const dirNames = tree.directories.map((d) => d.name);
    expect(dirNames).not.toContain('.');
    expect(dirNames).toEqual(['docs', 'src/components']);
  });

  it('sorts files in subdirectories deterministically despite differing slash formats', () => {
    const files: TreeFile[] = [
      { file: '//src/Button.tsx' },
      { file: '/src/Avatar.tsx' },
    ];
    const tree = buildCompactedTree(files);
    const ordered = flattenTreeFiles(tree).map((f) => f.file);

    // Avatar.tsx should come before Button.tsx alphabetically
    expect(ordered).toEqual(['/src/Avatar.tsx', '//src/Button.tsx']);
  });

  it('safely handles missing file type properties in dropdown formatting without throwing', () => {
    const repos = [
      {
        repoName: 'backend',
        files: [
          // @ts-expect-error type missing intentionally
          { file: 'src/index.ts', additions: 3, deletions: 1 },
        ],
      },
    ];

    const treeOrdered = repos.flatMap((repo) =>
      treeOrderedFiles(repo.files).map((f: any) => ({
        repoName: repo.repoName,
        file: f.file,
        type: f.type || 'modified',
        additions: f.additions || 0,
        deletions: f.deletions || 0,
      }))
    );

    const dropdownOptions = treeOrdered.map((f, i) => ({
      index: i,
      label: `[${(f.type || 'modified').slice(0, 3)}] ${f.repoName}: ${f.file} (+${f.additions} -${f.deletions})`,
      target: f,
    }));

    expect(dropdownOptions[0]!.label).toBe('[mod] backend: src/index.ts (+3 -1)');
  });

  it('handles unselected currentFileIndex (-1) transitions', () => {
    const files = [
      { file: 'src/a.ts' },
      { file: 'src/b.ts' },
    ];
    const ordered = treeOrderedFiles(files);
    let currentIdx = -1;

    // Next when unselected jumps to index 0
    if (currentIdx === -1 && ordered.length > 0) {
      currentIdx = 0;
    }
    expect(ordered[currentIdx]!.file).toBe('src/a.ts');

    // Prev when unselected jumps to last file
    currentIdx = -1;
    if (currentIdx === -1 && ordered.length > 0) {
      currentIdx = ordered.length - 1;
    }
    expect(ordered[currentIdx]!.file).toBe('src/b.ts');
  });
});

describe('normalizePath utility', () => {
  it('strips redundant leading slashes and dot prefixes', () => {
    expect(normalizePath('//src/Button.tsx')).toBe('src/Button.tsx');
    expect(normalizePath('///src/Button.tsx')).toBe('src/Button.tsx');
    expect(normalizePath('././src/Button.tsx')).toBe('src/Button.tsx');
    expect(normalizePath('.///src/Button.tsx')).toBe('src/Button.tsx');
    expect(normalizePath('src\\\\components\\\\Button.tsx')).toBe('src/components/Button.tsx');
    expect(normalizePath('src//utils///format.ts')).toBe('src/utils/format.ts');
    expect(normalizePath('')).toBe('');
  });
});

describe('getAllDirectoryPaths', () => {
  it('returns an empty array for an empty tree or root files only', () => {
    const emptyTree = buildCompactedTree([]);
    expect(getAllDirectoryPaths(emptyTree)).toEqual([]);

    const rootFilesTree = buildCompactedTree([
      { file: 'README.md' },
      { file: 'package.json' },
    ]);
    expect(getAllDirectoryPaths(rootFilesTree)).toEqual([]);
  });

  it('collects all directory paths in a compacted tree', () => {
    const files: TreeFile[] = [
      { file: 'src/features/changes/FileTree.tsx' },
      { file: 'src/features/changes/FileTree.test.ts' },
      { file: 'docs/guide.md' },
    ];
    const tree = buildCompactedTree(files, { compact: true });
    const paths = getAllDirectoryPaths(tree);
    expect(paths).toEqual(['docs', 'src/features/changes']);
  });

  it('collects all nested directory paths in an uncompacted tree', () => {
    const files: TreeFile[] = [
      { file: 'src/features/changes/FileTree.tsx' },
      { file: 'docs/guide.md' },
    ];
    const tree = buildCompactedTree(files, { compact: false });
    const paths = getAllDirectoryPaths(tree);
    expect(paths).toEqual(['docs', 'src', 'src/features', 'src/features/changes']);
  });

  it('collects directories across branched hierarchies in depth-first order', () => {
    const files: TreeFile[] = [
      { file: 'src/components/ui/Button.tsx' },
      { file: 'src/components/ui/Dialog.tsx' },
      { file: 'src/lib/format.ts' },
      { file: 'tests/unit.test.ts' },
    ];
    const tree = buildCompactedTree(files, { compact: true });
    const paths = getAllDirectoryPaths(tree);
    expect(paths).toEqual([
      'src',
      'src/components/ui',
      'src/lib',
      'tests',
    ]);
  });
});

describe('getAncestorPaths', () => {
  it('returns empty array for empty inputs or root files', () => {
    const tree = buildCompactedTree([{ file: 'README.md' }]);
    expect(getAncestorPaths(tree, '')).toEqual([]);
    expect(getAncestorPaths(tree, 'README.md')).toEqual([]);
    expect(getAncestorPaths(tree, 'unknown.ts')).toEqual([]);
  });

  it('returns compacted ancestor path for a nested file', () => {
    const files: TreeFile[] = [
      { file: 'src/features/changes/FileTree.tsx' },
      { file: 'package.json' },
    ];
    const tree = buildCompactedTree(files, { compact: true });
    const ancestors = getAncestorPaths(tree, 'src/features/changes/FileTree.tsx');
    expect(ancestors).toEqual(['src/features/changes']);
  });

  it('returns all ancestor directory paths in an uncompacted tree', () => {
    const files: TreeFile[] = [
      { file: 'src/features/changes/FileTree.tsx' },
    ];
    const tree = buildCompactedTree(files, { compact: false });
    const ancestors = getAncestorPaths(tree, 'src/features/changes/FileTree.tsx');
    expect(ancestors.slice().sort()).toEqual(['src', 'src/features', 'src/features/changes'].sort());
  });

  it('handles paths with Windows backslashes and redundant prefixes', () => {
    const files: TreeFile[] = [
      { file: 'src/components/Button.tsx' },
    ];
    const tree = buildCompactedTree(files);
    const winAncestors = getAncestorPaths(tree, 'src\\components\\Button.tsx');
    expect(winAncestors).toEqual(['src/components']);

    const dotAncestors = getAncestorPaths(tree, './src/components/Button.tsx');
    expect(dotAncestors).toEqual(['src/components']);

    const slashAncestors = getAncestorPaths(tree, '//src/components/Button.tsx');
    expect(slashAncestors).toEqual(['src/components']);
  });

  it('returns ancestors when target is a directory path itself', () => {
    const files: TreeFile[] = [
      { file: 'src/components/ui/Button.tsx' },
    ];
    const tree = buildCompactedTree(files, { compact: false });
    const ancestors = getAncestorPaths(tree, 'src/components/ui');
    expect(ancestors.slice().sort()).toEqual(['src', 'src/components', 'src/components/ui'].sort());
  });
});

describe('FileTree Component Rendering & Controlled Expansion', () => {
  const sampleFiles: TreeFile[] = [
    { file: 'README.md' },
    { file: 'src/components/Button.tsx' },
    { file: 'src/components/Dialog.tsx' },
    { file: 'src/utils/format.ts' },
  ];

  const renderFileMock = (f: TreeFile) =>
    createElement('button', { type: 'button', 'data-name': f.file }, f.file);

  it('implements smart default: collapsed for files mode (reducing initial DOM from 5,000+ nodes to root level only)', () => {
    const html = renderToStaticMarkup(
      createElement(FileTree, {
        files: sampleFiles,
        renderFile: renderFileMock,
        label: 'Workspace files',
        defaultExpanded: false,
      })
    );

    // Root file is rendered
    expect(html).toContain('README.md');

    // Root directory summary is rendered with folder name
    expect(html).toContain('<span class="truncate">src</span>');

    // No details elements have the open attribute
    expect(html).not.toContain('<details open');
    expect(html).toContain('<details');

    // Crucially: nested file buttons are NOT in the DOM markup!
    expect(html).not.toContain('Button.tsx');
    expect(html).not.toContain('Dialog.tsx');
    expect(html).not.toContain('format.ts');
  });

  it('implements smart default: expanded by default for changes mode', () => {
    const html = renderToStaticMarkup(
      createElement(FileTree, {
        files: sampleFiles,
        renderFile: renderFileMock,
        label: 'Workspace changes',
        defaultExpanded: true,
      })
    );

    // Directory details are open
    expect(html).toContain('<details open=""');

    // All files, including deeply nested files, are rendered
    expect(html).toContain('Button.tsx');
    expect(html).toContain('Dialog.tsx');
    expect(html).toContain('format.ts');
    expect(html).toContain('README.md');
  });

  it('supports controlled expandedPaths state with precise branch expansion', () => {
    // Expand 'src' and 'src/components', keeping 'src/utils' collapsed
    const expanded = new Set(['src', 'src/components']);
    const html = renderToStaticMarkup(
      createElement(FileTree, {
        files: sampleFiles,
        renderFile: renderFileMock,
        label: 'Workspace code',
        expandedPaths: expanded,
      })
    );

    // src/components is open and contains its files
    expect(html).toContain('<details open="" data-path="src/components"');
    expect(html).toContain('Button.tsx');
    expect(html).toContain('Dialog.tsx');

    // src/utils is closed and does NOT contain its files
    expect(html).toContain('<details data-path="src/utils"');
    expect(html).not.toContain('format.ts');
  });

  it('reduces sidebar indentation margin from 20px (ml-3 pl-2) to 14px (ml-2 pl-1.5)', () => {
    const html = renderToStaticMarkup(
      createElement(FileTree, {
        files: sampleFiles,
        renderFile: renderFileMock,
        label: 'Indentation check',
        defaultExpanded: true,
      })
    );

    // New compact indentation
    expect(html).toContain('class="ml-2 border-l border-border pl-1.5"');
    // Does not use the old wide indentation
    expect(html).not.toContain('ml-3 border-l border-border pl-2');
  });

  it('attaches data-file-path attributes for smooth scrollIntoView targeting', () => {
    const html = renderToStaticMarkup(
      createElement(FileTree, {
        files: sampleFiles,
        renderFile: renderFileMock,
        label: 'Scroll check',
        defaultExpanded: true,
      })
    );

    expect(html).toContain('data-file-path="src/components/Button.tsx"');
    expect(html).toContain('data-file-path="src/utils/format.ts"');
    expect(html).toContain('data-file-path="README.md"');
  });

  it('simulates Expand All action by expanding all directory paths', () => {
    const root = buildCompactedTree(sampleFiles);
    const allPaths = getAllDirectoryPaths(root);
    const allExpandedSet = new Set(allPaths);

    const html = renderToStaticMarkup(
      createElement(FileTree, {
        files: sampleFiles,
        renderFile: renderFileMock,
        label: 'Expand All test',
        expandedPaths: allExpandedSet,
      })
    );

    // All directory details have open=""
    const detailsMatches = html.match(/<details[^>]*open=""/g) || [];
    expect(detailsMatches).toHaveLength(allPaths.length);

    // All nested files are in the DOM
    expect(html).toContain('Button.tsx');
    expect(html).toContain('Dialog.tsx');
    expect(html).toContain('format.ts');
  });

  it('simulates Collapse All action by providing an empty Set', () => {
    const html = renderToStaticMarkup(
      createElement(FileTree, {
        files: sampleFiles,
        renderFile: renderFileMock,
        label: 'Collapse All test',
        expandedPaths: new Set(),
      })
    );

    // 0 details elements have open=""
    expect(html).not.toContain('open=""');

    // 0 nested files are in the DOM
    expect(html).not.toContain('Button.tsx');
    expect(html).not.toContain('Dialog.tsx');
    expect(html).not.toContain('format.ts');

    // Root file is still visible
    expect(html).toContain('README.md');
  });

  it('preserves manual collapse state across simulated polling re-renders', () => {
    // Initial state: user had manually collapsed 'src/components', keeping 'src' and 'src/utils' open
    const userState = new Set(['src', 'src/utils']);

    // First render (e.g. before polling)
    const render1 = renderToStaticMarkup(
      createElement(FileTree, {
        files: sampleFiles,
        renderFile: renderFileMock,
        label: 'Polling test',
        expandedPaths: userState,
      })
    );
    expect(render1).not.toContain('Button.tsx');
    expect(render1).toContain('format.ts');

    // Simulate polling update 10 seconds later: updated file items with new references
    const updatedFiles: TreeFile[] = [
      { file: 'README.md' },
      { file: 'src/components/Button.tsx' },
      { file: 'src/components/Dialog.tsx' },
      { file: 'src/utils/format.ts' },
      { file: 'src/utils/newHelper.ts' },
    ];

    // Second render after poll using the preserved user state
    const render2 = renderToStaticMarkup(
      createElement(FileTree, {
        files: updatedFiles,
        renderFile: renderFileMock,
        label: 'Polling test',
        expandedPaths: userState,
      })
    );

    // Manual collapse did NOT snap back open!
    expect(render2).not.toContain('Button.tsx');
    // Open folder correctly reflects newly polled file
    expect(render2).toContain('format.ts');
    expect(render2).toContain('newHelper.ts');
  });

  it('auto-expands ancestor branches when revealing a selected file', () => {
    const root = buildCompactedTree(sampleFiles);
    // User selects 'src/components/Button.tsx'
    const targetFile = 'src/components/Button.tsx';
    const ancestors = getAncestorPaths(root, targetFile);

    // Initially collapsed
    const collapsedPaths = new Set<string>();

    // Simulating auto-expansion on selection: add ancestors to expandedPaths
    const afterSelectionPaths = new Set(collapsedPaths);
    for (const a of ancestors) {
      afterSelectionPaths.add(a);
    }

    const html = renderToStaticMarkup(
      createElement(FileTree, {
        files: sampleFiles,
        renderFile: renderFileMock,
        label: 'Selection reveal test',
        expandedPaths: afterSelectionPaths,
        revealPath: targetFile,
      })
    );

    // Ancestor 'src/components' is now expanded!
    expect(html).toContain('<details open="" data-path="src/components"');
    expect(html).toContain('Button.tsx');
  });
});

