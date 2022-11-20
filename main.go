package main

import (
	"log"
	"os"

	"github.com/lherman-cs/dev/setup"
	"github.com/lherman-cs/dev/ws"
	"github.com/urfave/cli/v2"
)

func main() {
	app := &cli.App{
		Commands: []*cli.Command{
			setup.Command(),
			ws.Command(),
		},
	}

	if err := app.Run(os.Args); err != nil {
		log.Fatal(err)
	}
}
