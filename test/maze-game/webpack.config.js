/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

const path = require('path');
const webpack = require('webpack');
const { execSync } = require('child_process');

function getBuildSha() {
  try {
    const sha = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
    const dirty = execSync('git status --porcelain', { encoding: 'utf8' }).trim();
    return sha + (dirty ? '*' : '');
  } catch (e) {
    return 'unknown';
  }
}

module.exports = {
  mode: 'development',
  entry: './test/maze-game/index.ts',
  devtool: 'eval-source-map',
  output: {
    path: path.resolve(__dirname),
    filename: 'bundle.js',
    clean: false,
  },
  resolve: {
    extensions: ['.ts', '.js'],
    fallback: {
      'util': false,
      'vm': false, // js-interpreter tries to import vm module, but we don't need it in browser
    },
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: 'ts-loader',
        exclude: /node_modules/,
      },
    ],
  },
  plugins: [
    new webpack.DefinePlugin({
      'process.env.NODE_ENV': JSON.stringify('development'),
      '__BUILD_SHA__': JSON.stringify(getBuildSha()),
    }),
  ],
  devServer: {
    static: {
      directory: path.join(__dirname),
    },
    compress: true,
    port: 8082,
    open: true,
    hot: false, // Disable HMR to prevent re-initialization issues
    liveReload: false, // Disable live reload for stability
    client: {
      overlay: {
        // ResizeObserver loop errors have event.error === undefined which crashes
        // the overlay's own error.stack access. Suppress them — they're harmless
        // browser bookkeeping errors, not real application errors.
        runtimeErrors: (error) => !!error,
      },
    },
  },
};
