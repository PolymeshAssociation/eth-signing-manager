module.exports = {
  repositoryUrl: 'https://github.com/PolymeshAssociation/eth-signing-manager.git',
  branches: [
    'master',
    {
      name: 'alpha',
      prerelease: true,
    },
    {
      name: 'beta',
      prerelease: true,
    },
  ],
  /*
   * Plugin order matters: @semantic-release/changelog generates CHANGELOG.md, then the **prepare**
   * step of @semantic-release/npm updates the package.json version and builds the tarball, then
   * @semantic-release/github creates the GitHub Release with the changelog attached as an asset.
   *
   * Note @semantic-release/git is deliberately **not** in this list, so nothing is committed back
   * to the repository — no release commit, and CHANGELOG.md lives only on the GitHub Release.
   * Release branches require signed commits, which CI cannot produce.
   *
   * See:
   *  - https://github.com/semantic-release/semantic-release/blob/beta/docs/usage/plugins.md#plugin-ordering
   *  - https://github.com/semantic-release/semantic-release/blob/beta/docs/extending/plugins-list.md
   */
  plugins: [
    '@semantic-release/commit-analyzer',
    '@semantic-release/release-notes-generator',
    '@semantic-release/changelog',
    [
      '@semantic-release/npm',
      {
        tarballDir: 'npm-package/',
      },
    ],
    [
      '@semantic-release/github',
      {
        assets: ['CHANGELOG.md'],
      },
    ],
  ],
};
