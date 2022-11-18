package ws

import (
	"fmt"
	"github.com/urfave/cli/v2"
)

func Commands() []*cli.Command {
	return []*cli.Command{{
		Name:    "init",
		Aliases: []string{"a"},
		Usage:   "add a task to the list",
		Action: func(cCtx *cli.Context) error {
			fmt.Println("added task: ", cCtx.Args().First())
			return nil
		},
	},
	}
}
