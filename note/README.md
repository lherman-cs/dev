# Note

Basic LSP server that gives an autocompletion (codelens) capability to Markdown files. 

## Symbol Autocompletion

Tag format: @@\w+#\w+ (tag=first '\w+', value=second '\w+')

The LSP will heavily utilize ripgrep to fulfil the symbol autocompletion, and will be stateless.

### How to search for available tags?

1. ripgrep @@\w+#\w+
2. Remove values
3. Sort and uniq the results

### How to search for available values for a tag?

1. ripgrep @@<tag>#\w+
2. Sort results
