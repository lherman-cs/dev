package setup

import (
	"github.com/urfave/cli/v2"
)

func Command() *cli.Command {
	return &cli.Command{
		Name:   "init",
		Usage:  "init workspace",
		Action: cmdSetup,
	}
}

func cmdSetup(cliCtx *cli.Context) error {
	return nil
}
