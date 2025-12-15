# Installing oh-my-opencode Per Project

This guide explains how to install oh-my-opencode at the project level instead of globally.

## Why Project-Level Installation?

- **Team sharing**: Configuration is committed to Git, so all team members get the same setup
- **Project isolation**: Different projects can have different plugin configurations
- **Reproducibility**: Anyone cloning the repo gets the same OpenCode experience

## Installation Steps

### 1. Create Project OpenCode Config

```bash
# Navigate to your project root
cd /path/to/your-project

# Create .opencode directory
mkdir -p .opencode

# Create opencode.json with oh-my-opencode plugin
echo '{"plugin":["oh-my-opencode"]}' > .opencode/opencode.json
```

If you already have an existing `.opencode/opencode.json`:

```bash
# Using jq to add plugin to existing config
jq '.plugin = ((.plugin // []) + ["oh-my-opencode"] | unique)' \
    .opencode/opencode.json > /tmp/oc.json && \
    mv /tmp/oc.json .opencode/opencode.json
```

### 2. (Optional) Add Project-Specific Plugin Settings

Create `.opencode/oh-my-opencode.json` for project-specific customization:

```json
{
  "$schema": "https://raw.githubusercontent.com/code-yeongyu/oh-my-opencode/master/assets/oh-my-opencode.schema.json",
  "google_auth": true,
  "disabled_hooks": ["comment-checker"],
  "disabled_agents": ["frontend-ui-ux-engineer"],
  "disabled_mcps": ["grep_app"]
}
```

### 3. Verify Installation

```bash
# Check OpenCode version (requires 1.0.132 or higher)
opencode --version

# Verify plugin is configured
cat .opencode/opencode.json
# Should output: {"plugin":["oh-my-opencode"]}
```

### 4. Commit to Git

```bash
git add .opencode/opencode.json
git add .opencode/oh-my-opencode.json  # if exists
git commit -m "Add oh-my-opencode plugin configuration"
```

## Configuration Priority

OpenCode loads configuration in the following priority order (highest to lowest):

| Priority | Location | Scope |
|----------|----------|-------|
| 1 (highest) | `.opencode/opencode.json` | Project |
| 2 | `.opencode/oh-my-opencode.json` | Project plugin settings |
| 3 | `~/.config/opencode/opencode.json` | Global |
| 4 (lowest) | `~/.config/opencode/oh-my-opencode.json` | Global plugin settings |

Project-level settings override global settings.

## Directory Structure

After installation, your project should have:

```
your-project/
├── .opencode/
│   ├── opencode.json           # Required: plugin declaration
│   └── oh-my-opencode.json     # Optional: plugin customization
├── src/
└── ...
```

## Comparison: Global vs Project Installation

| Aspect | Global (`~/.config/opencode/`) | Project (`.opencode/`) |
|--------|-------------------------------|------------------------|
| Scope | All projects | Single project |
| Git tracking | No | Yes |
| Team sharing | Manual | Automatic |
| Override | Lower priority | Higher priority |

## Troubleshooting

### Plugin not loading

1. Ensure OpenCode version is 1.0.132 or higher
2. Check that `.opencode/opencode.json` contains valid JSON
3. Verify the plugin name is exactly `"oh-my-opencode"`

### Configuration not applied

1. Project config takes priority over global config
2. Restart OpenCode after changing configuration
3. Check for JSON syntax errors in config files

## References

- [OpenCode Plugins Documentation](https://opencode.ai/docs/plugins/)
- [oh-my-opencode README](https://github.com/code-yeongyu/oh-my-opencode#readme)
- [OpenCode Configuration](https://opencode.ai/docs/config/)
