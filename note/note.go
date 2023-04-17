package note

import (
	"bufio"
	"bytes"
	"context"
	"fmt"
	"io"
	"io/fs"
	"io/ioutil"
	"os"
	"os/signal"
	"path/filepath"

	"github.com/urfave/cli/v2"
	"go.lsp.dev/jsonrpc2"
	"go.lsp.dev/protocol"
	"go.uber.org/zap"
)

var (
	triggerCharacter = []byte("@")
	equalCharacter   = []byte("=")
)

var logFile *os.File

func Command() *cli.Command {
	return &cli.Command{
		Name:   "note",
		Usage:  "note starts note-taking LSP server",
		Action: cmdStart,
		Subcommands: []*cli.Command{
			{
				Name:   "start",
				Usage:  "start LSP server",
				Action: cmdStart,
			},
			{
				Name:   "exec",
				Usage:  "run completion in cli",
				Action: cmdExec,
			},
		},
	}
}

func cmdExec(cliCtx *cli.Context) error {
	tags := findTags(os.DirFS("."))
	for _, tag := range tags {
		fmt.Println(string(tag.Word))
	}
	return nil
}

type stdio struct {
	io.ReadCloser
	io.Writer
}

func cmdStart(cliCtx *cli.Context) error {
	var err error
	logFile, err = os.Create("log.txt")
	if err != nil {
		panic(err)
	}
	s := newServer()
	s.start(cliCtx.Context)
	// socket, err := net.Listen("unix", "TODO")
	// if err != nil {
	// 	return fmt.Errorf("failed to create unix socket: %w", err)
	// }

	// for {
	// 	socketConn, err := socket.Accept()
	// 	if err != nil {
	// 		log.Println("failed to create unix conn: %w", err)
	// 	} else {
	// 		handleConn(cliCtx.Context, socketConn)
	// 	}
	// }
	return nil
}

type server struct {
	signalCh chan os.Signal
}

func newServer() *server {
	c := make(chan os.Signal, 1)
	signal.Notify(c, os.Interrupt)

	return &server{
		signalCh: c,
	}
}

func (s *server) start(ctx context.Context) {
	ioStream := stdio{
		ReadCloser: ioutil.NopCloser(os.Stdin),
		Writer:     os.Stdout,
	}

	ioStream.ReadCloser = ioutil.NopCloser(io.TeeReader(ioStream.ReadCloser, logFile))
	ioStream.Writer = io.MultiWriter(ioStream.Writer, logFile)

	stream := jsonrpc2.NewStream(&ioStream)
	ctx, conn, _ := protocol.NewServer(ctx, &server{}, stream, zap.L())
	// FIXME: close conn somehwere
	_ = conn
	<-s.signalCh
}

func (s *server) Initialize(ctx context.Context, params *protocol.InitializeParams) (*protocol.InitializeResult, error) {
	comp := protocol.CompletionOptions{
		TriggerCharacters: []string{string(triggerCharacter)},
	}
	return &protocol.InitializeResult{
		Capabilities: protocol.ServerCapabilities{
			CompletionProvider: &comp,
		},
	}, nil
}

func (s *server) Initialized(ctx context.Context, params *protocol.InitializedParams) (err error) {
	return nil
}

func (s *server) Shutdown(ctx context.Context) (err error) {
	close(s.signalCh)
	return nil
}

func (s *server) Exit(ctx context.Context) (err error) {
	close(s.signalCh)
	return nil
}

func (s *server) WorkDoneProgressCancel(ctx context.Context, params *protocol.WorkDoneProgressCancelParams) (err error) {
	return
}
func (s *server) LogTrace(ctx context.Context, params *protocol.LogTraceParams) (err error) {
	return
}
func (s *server) SetTrace(ctx context.Context, params *protocol.SetTraceParams) (err error) {
	return
}
func (s *server) CodeAction(ctx context.Context, params *protocol.CodeActionParams) (result []protocol.CodeAction, err error) {
	return
}
func (s *server) CodeLens(ctx context.Context, params *protocol.CodeLensParams) (result []protocol.CodeLens, err error) {
	return
}
func (s *server) CodeLensResolve(ctx context.Context, params *protocol.CodeLens) (result *protocol.CodeLens, err error) {
	return
}
func (s *server) ColorPresentation(ctx context.Context, params *protocol.ColorPresentationParams) (result []protocol.ColorPresentation, err error) {
	return
}
func (s *server) Completion(ctx context.Context, params *protocol.CompletionParams) (result *protocol.CompletionList, err error) {
	tags := findTags(os.DirFS("."))
	results := make([]protocol.CompletionItem, 0, len(tags))
	for _, tag := range tags {
		word := string(tag.Word)
		results = append(results, protocol.CompletionItem{
			InsertText: word,
			Label:      word,
			Kind:       protocol.CompletionItemKindText,
		})
	}

	return &protocol.CompletionList{
		IsIncomplete: false,
		Items:        results,
	}, nil
}
func (s *server) CompletionResolve(ctx context.Context, params *protocol.CompletionItem) (result *protocol.CompletionItem, err error) {
	return
}
func (s *server) Declaration(ctx context.Context, params *protocol.DeclarationParams) (result []protocol.Location /* Declaration | DeclarationLink[] | null */, err error) {
	return
}
func (s *server) Definition(ctx context.Context, params *protocol.DefinitionParams) (result []protocol.Location /* Definition | DefinitionLink[] | null */, err error) {
	return
}
func (s *server) DidChange(ctx context.Context, params *protocol.DidChangeTextDocumentParams) (err error) {
	return
}
func (s *server) DidChangeConfiguration(ctx context.Context, params *protocol.DidChangeConfigurationParams) (err error) {
	return
}
func (s *server) DidChangeWatchedFiles(ctx context.Context, params *protocol.DidChangeWatchedFilesParams) (err error) {
	return
}
func (s *server) DidChangeWorkspaceFolders(ctx context.Context, params *protocol.DidChangeWorkspaceFoldersParams) (err error) {
	return
}
func (s *server) DidClose(ctx context.Context, params *protocol.DidCloseTextDocumentParams) (err error) {
	return
}
func (s *server) DidOpen(ctx context.Context, params *protocol.DidOpenTextDocumentParams) (err error) {
	return
}
func (s *server) DidSave(ctx context.Context, params *protocol.DidSaveTextDocumentParams) (err error) {
	return
}
func (s *server) DocumentColor(ctx context.Context, params *protocol.DocumentColorParams) (result []protocol.ColorInformation, err error) {
	return
}
func (s *server) DocumentHighlight(ctx context.Context, params *protocol.DocumentHighlightParams) (result []protocol.DocumentHighlight, err error) {
	return
}
func (s *server) DocumentLink(ctx context.Context, params *protocol.DocumentLinkParams) (result []protocol.DocumentLink, err error) {
	return
}
func (s *server) DocumentLinkResolve(ctx context.Context, params *protocol.DocumentLink) (result *protocol.DocumentLink, err error) {
	return
}
func (s *server) DocumentSymbol(ctx context.Context, params *protocol.DocumentSymbolParams) (result []interface{} /* []SymbolInformation | []DocumentSymbol */, err error) {
	return
}
func (s *server) ExecuteCommand(ctx context.Context, params *protocol.ExecuteCommandParams) (result interface{}, err error) {
	return
}
func (s *server) FoldingRanges(ctx context.Context, params *protocol.FoldingRangeParams) (result []protocol.FoldingRange, err error) {
	return
}
func (s *server) Formatting(ctx context.Context, params *protocol.DocumentFormattingParams) (result []protocol.TextEdit, err error) {
	return
}
func (s *server) Hover(ctx context.Context, params *protocol.HoverParams) (result *protocol.Hover, err error) {
	return
}
func (s *server) Implementation(ctx context.Context, params *protocol.ImplementationParams) (result []protocol.Location, err error) {
	return
}
func (s *server) OnTypeFormatting(ctx context.Context, params *protocol.DocumentOnTypeFormattingParams) (result []protocol.TextEdit, err error) {
	return
}
func (s *server) PrepareRename(ctx context.Context, params *protocol.PrepareRenameParams) (result *protocol.Range, err error) {
	return
}
func (s *server) RangeFormatting(ctx context.Context, params *protocol.DocumentRangeFormattingParams) (result []protocol.TextEdit, err error) {
	return
}
func (s *server) References(ctx context.Context, params *protocol.ReferenceParams) (result []protocol.Location, err error) {
	return
}
func (s *server) Rename(ctx context.Context, params *protocol.RenameParams) (result *protocol.WorkspaceEdit, err error) {
	return
}
func (s *server) SignatureHelp(ctx context.Context, params *protocol.SignatureHelpParams) (result *protocol.SignatureHelp, err error) {
	return
}
func (s *server) Symbols(ctx context.Context, params *protocol.WorkspaceSymbolParams) (result []protocol.SymbolInformation, err error) {
	return
}
func (s *server) TypeDefinition(ctx context.Context, params *protocol.TypeDefinitionParams) (result []protocol.Location, err error) {
	return
}
func (s *server) WillSave(ctx context.Context, params *protocol.WillSaveTextDocumentParams) (err error) {
	return
}
func (s *server) WillSaveWaitUntil(ctx context.Context, params *protocol.WillSaveTextDocumentParams) (result []protocol.TextEdit, err error) {
	return
}
func (s *server) ShowDocument(ctx context.Context, params *protocol.ShowDocumentParams) (result *protocol.ShowDocumentResult, err error) {
	return
}
func (s *server) WillCreateFiles(ctx context.Context, params *protocol.CreateFilesParams) (result *protocol.WorkspaceEdit, err error) {
	return
}
func (s *server) DidCreateFiles(ctx context.Context, params *protocol.CreateFilesParams) (err error) {
	return
}
func (s *server) WillRenameFiles(ctx context.Context, params *protocol.RenameFilesParams) (result *protocol.WorkspaceEdit, err error) {
	return
}
func (s *server) DidRenameFiles(ctx context.Context, params *protocol.RenameFilesParams) (err error) {
	return
}
func (s *server) WillDeleteFiles(ctx context.Context, params *protocol.DeleteFilesParams) (result *protocol.WorkspaceEdit, err error) {
	return
}
func (s *server) DidDeleteFiles(ctx context.Context, params *protocol.DeleteFilesParams) (err error) {
	return
}
func (s *server) CodeLensRefresh(ctx context.Context) (err error) {
	return
}
func (s *server) PrepareCallHierarchy(ctx context.Context, params *protocol.CallHierarchyPrepareParams) (result []protocol.CallHierarchyItem, err error) {
	return
}
func (s *server) IncomingCalls(ctx context.Context, params *protocol.CallHierarchyIncomingCallsParams) (result []protocol.CallHierarchyIncomingCall, err error) {
	return
}
func (s *server) OutgoingCalls(ctx context.Context, params *protocol.CallHierarchyOutgoingCallsParams) (result []protocol.CallHierarchyOutgoingCall, err error) {
	return
}
func (s *server) SemanticTokensFull(ctx context.Context, params *protocol.SemanticTokensParams) (result *protocol.SemanticTokens, err error) {
	return
}
func (s *server) SemanticTokensFullDelta(ctx context.Context, params *protocol.SemanticTokensDeltaParams) (result interface{} /* SemanticTokens | SemanticTokensDelta */, err error) {
	return
}
func (s *server) SemanticTokensRange(ctx context.Context, params *protocol.SemanticTokensRangeParams) (result *protocol.SemanticTokens, err error) {
	return
}
func (s *server) SemanticTokensRefresh(ctx context.Context) (err error) {
	return
}
func (s *server) LinkedEditingRange(ctx context.Context, params *protocol.LinkedEditingRangeParams) (result *protocol.LinkedEditingRanges, err error) {
	return
}
func (s *server) Moniker(ctx context.Context, params *protocol.MonikerParams) (result []protocol.Moniker, err error) {
	return
}
func (s *server) Request(ctx context.Context, method string, params interface{}) (result interface{}, err error) {
	return
}

type Tag struct {
	Key   []byte
	Value []byte
	// Word is full encoded version
	Word []byte
}

func findTags(filesystem fs.FS) []Tag {
	var tags []Tag

	fs.WalkDir(filesystem, ".", func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}

		if filepath.Ext(path) != ".md" {
			return nil
		}

		parsedTags, err := parseTags(filesystem, path)
		if err != nil {
			return nil
		}
		tags = append(tags, parsedTags...)
		return nil
	})

	return tags
}

func parseTags(filesystem fs.FS, path string) ([]Tag, error) {
	file, err := filesystem.Open(path)
	if err != nil {
		return nil, fmt.Errorf("failed to open file: %w", err)
	}
	defer file.Close()

	stat, err := file.Stat()
	if err != nil {
		return nil, fmt.Errorf("failed to stat: %w", err)
	}

	if stat.Mode()&os.ModeSymlink != 0 {
		return nil, nil
	}

	scanner := bufio.NewScanner(file)
	scanner.Split(bufio.ScanWords)
	var tags []Tag

	for scanner.Scan() {
		tag, ok := parseTag(scanner.Bytes())
		if ok {
			tags = append(tags, tag)
		}
	}

	return tags, nil
}

func parseTag(word []byte) (Tag, bool) {
	token, ok := bytes.CutPrefix(word, triggerCharacter)
	if !ok {
		return Tag{}, false
	}

	idx := bytes.Index(token, equalCharacter)
	if idx == -1 {
		return Tag{}, false
	}

	tag := Tag{
		Key:   token[:idx],
		Value: token[idx+1:],
		Word:  word,
	}
	return tag, true
}
