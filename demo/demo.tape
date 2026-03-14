# VHS demo tape for spec2cli
# Run: node examples/todo-api/server.mjs & sleep 1 && vhs demo/demo.tape

Output demo/demo.gif

Set Shell "bash"
Set FontSize 15
Set Width 900
Set Height 550
Set Theme "Catppuccin Mocha"
Set Padding 15
Set TypingSpeed 40ms

# Title
Type "# spec2cli — Turn any API into a CLI"
Enter
Sleep 1s

# Help
Type "node dist/index.js --spec examples/todo-api/openapi.yaml --help"
Enter
Sleep 2.5s

# List with table
Type "node dist/index.js --spec examples/todo-api/openapi.yaml --base-url http://localhost:4000 --output table todos list"
Enter
Sleep 2.5s

# Filter
Type "node dist/index.js --spec examples/todo-api/openapi.yaml --base-url http://localhost:4000 --output table todos list --status pending"
Enter
Sleep 2.5s

# Get single item as YAML
Type "node dist/index.js --spec examples/todo-api/openapi.yaml --base-url http://localhost:4000 --output yaml todos get --id 1"
Enter
Sleep 2.5s

# Create with auth
Type "node dist/index.js --spec examples/todo-api/openapi.yaml --base-url http://localhost:4000 --token test-token-123 --output json todos create --title 'Ship spec2cli v1' --priority high"
Enter
Sleep 2.5s

# Search registry
Type "node dist/index.js search payments"
Enter
Sleep 2.5s

# Agent help
Type "node dist/index.js --spec examples/todo-api/openapi.yaml --agent-help"
Enter
Sleep 4s

Sleep 1s
