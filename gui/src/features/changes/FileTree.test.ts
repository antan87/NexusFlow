import { describe, expect, it } from 'vitest';
import {
  buildCompactedTree,
  flattenTreeFiles,
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
});
