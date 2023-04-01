package main

import (
	"log"
	"os"

	"github.com/lherman-cs/dev/ws"
	pkginit "github.com/lherman-cs/dev/init"
	"github.com/urfave/cli/v2"
)

func main() {
	app := &cli.App{
		Commands: []*cli.Command{
			ws.Command(),
			pkginit.Command(),
		},
	}

	if err := app.Run(os.Args); err != nil {
		log.Fatal(err)
	}
}
