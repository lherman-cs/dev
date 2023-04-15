package main

import (
	"log"
	"os"

	pkginit "github.com/lherman-cs/dev/init"
	"github.com/lherman-cs/dev/note"
	"github.com/lherman-cs/dev/ws"
	"github.com/urfave/cli/v2"
)

func main() {
	app := &cli.App{
		Commands: []*cli.Command{
			ws.Command(),
			pkginit.Command(),
			note.Command(),
		},
	}

	if err := app.Run(os.Args); err != nil {
		log.Fatal(err)
	}
}
