package main

import (
	"log"
	"os"

	"github.com/lherman-cs/dev/ws"
	"github.com/urfave/cli/v2"
)

func main() {
	app := &cli.App{
		Commands: []*cli.Command{
			{
				Name:        "ws",
				Usage:       "workspace actions",
				Subcommands: ws.Commands(),
			},
		},
	}

	if err := app.Run(os.Args); err != nil {
		log.Fatal(err)
	}
}
