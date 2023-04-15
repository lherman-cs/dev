package note

import (
	"context"
	"fmt"
	"log"
	"net"

	"github.com/urfave/cli/v2"
	"go.lsp.dev/jsonrpc2"
	"go.lsp.dev/protocol"
)

func Command() *cli.Command {
	return &cli.Command{
		Name:   "note",
		Usage:  "note starts note-taking LSP server",
		Action: cmdInit,
	}
}

func cmdInit(cliCtx *cli.Context) error {
	socket, err := net.Listen("unix", "TODO")
	if err != nil {
		return fmt.Errorf("failed to create unix socket: %w", err)
	}

	for {
		socketConn, err := socket.Accept()
		if err != nil {
			log.Println("failed to create unix conn: %w", err)
		} else {
			handleConn(cliCtx.Context, socketConn)
		}
	}
}

func handleConn(ctx context.Context, socketConn net.Conn) {
	stream := jsonrpc2.NewStream(socketConn)
	ctx, conn, _ := protocol.NewServer(ctx, &server{}, stream, nil)
	// FIXME: close conn somehwere
	_ = conn
}

type server struct {
	protocol.Server
}

func (s *server) Completion(ctx context.Context, params *protocol.CompletionParams) (result *protocol.CompletionList, err error) {
	return nil, nil
}
