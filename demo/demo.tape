# VHS demo tape for spec2cli
# Run: vhs demo/demo.tape

Output demo/demo.gif
Output demo/demo.webm

Set Shell "bash"
Set FontSize 14
Set Width 1000
Set Height 600
Set Theme "Catppuccin Mocha"
Set Padding 20

Type "# Explore any API instantly"
Enter
Sleep 500ms

Type "npx spec2cli use petstore pet --help"
Enter
Sleep 4s

Type "# List pets with table output"
Enter
Sleep 500ms

Type "npx spec2cli use petstore pet findpetsbystatus --status available --output table --max-items 5"
Enter
Sleep 5s

Type "# Get a pet as YAML"
Enter
Sleep 500ms

Type "npx spec2cli --spec test/fixtures/petstore.yaml --output yaml pets get --petId 1 --base-url https://petstore3.swagger.io/api/v3"
Enter
Sleep 4s

Type "# Search the API registry"
Enter
Sleep 500ms

Type "npx spec2cli search payments"
Enter
Sleep 3s

Type "# AI agent help — everything in one call"
Enter
Sleep 500ms

Type "npx spec2cli --spec test/fixtures/petstore.yaml --agent-help"
Enter
Sleep 5s

Sleep 2s
