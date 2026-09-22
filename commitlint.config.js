module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'scope-enum': [
      2,
      'always',
      [
        'typescript',
        'react',
        'nextjs',
        'react-native',
        'go',
        'python',
        'rust',
        'dotnet',
        'java',
        'kotlin',
        'dart',
        'ruby',
        'php',
        'swift',
        'deps',
        'ci',
        'release'
      ]
    ],
    'scope-empty': [2, 'never']
  }
};
