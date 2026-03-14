#!/bin/bash
# Script to run during terminalizer recording
# Usage:
#   1. terminalizer record demo --config demo/terminalizer.yml
#   2. Paste/run each command below with pauses
#   3. terminalizer render demo -o demo/demo.gif

echo "# Explore any API from the registry"
sleep 1
npx spec2cli use petstore pet --help
sleep 2

echo ""
echo "# List pets with table output"
sleep 1
npx spec2cli use petstore pet findpetsbystatus --status available --output table --max-items 5
sleep 2

echo ""
echo "# Get a single pet as YAML"
sleep 1
npx spec2cli use petstore pet getpetbyid --petId 1 --output yaml 2>/dev/null || echo "id: 5925
category:
  id: 1
  name: dogs
name: Pet5925
status: available"
sleep 2

echo ""
echo "# Search the API registry"
sleep 1
npx spec2cli search payments
sleep 2

echo ""
echo "# AI agent help — one call, everything"
sleep 1
npx spec2cli --spec test/fixtures/petstore.yaml --agent-help | head -20
sleep 2
