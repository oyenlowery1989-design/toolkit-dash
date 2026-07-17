#!/bin/bash
set -e
cd "$(dirname "$0")"
git pull origin main
npm ci
npm run build
pm2 restart stellar-toolkit
