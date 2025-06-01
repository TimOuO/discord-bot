import { Client, ClientOptions, Collection } from "discord.js";
import { Command } from "../commands";

export class ExtendedClient extends Client {
  public commands: Collection<string, Command>;

  constructor(options: ClientOptions) {
    super(options);
    this.commands = new Collection<string, Command>();
  }
}
