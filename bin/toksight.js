#!/usr/bin/env node
import { main } from '../src/cli.js';

main(process.argv.slice(2))
  .then((code) => {
    if (code) process.exitCode = code;
  })
  .catch((err) => {
    console.error(err?.stack || err);
    process.exitCode = 1;
  });
