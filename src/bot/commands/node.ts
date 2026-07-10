import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import type { SlashCommandModule } from '../commandModule.js';

function describeNode(node: { id: string; kind: string; displayName: string }): string {
  const name = node.displayName || '(unnamed)';
  const shortId = node.id.length > 12 ? `${node.id.slice(0, 12)}...` : node.id;

  return `**${name}** (\`${shortId}\`, ${node.kind})`;
}

export const nodeCommand: SlashCommandModule = {
  data: new SlashCommandBuilder()
    .setName('node')
    .setDescription('Manage relay nodes (game servers and Discord channels)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) =>
      sub.setName('list').setDescription('List all known nodes'),
    )
    .addSubcommand((sub) =>
      sub
        .setName('rename')
        .setDescription('Rename a node')
        .addStringOption((opt) =>
          opt
            .setName('node')
            .setDescription('The node to rename')
            .setRequired(true)
            .setAutocomplete(true),
        )
        .addStringOption((opt) =>
          opt.setName('name').setDescription('The new display name').setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('delete')
        .setDescription('Delete a node and any links referencing it')
        .addStringOption((opt) =>
          opt
            .setName('node')
            .setDescription('The node to delete')
            .setRequired(true)
            .setAutocomplete(true),
        ),
    ),

  async execute(interaction, ctx) {
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'list') {
      const nodes = ctx.store.nodes.list();

      if (nodes.length === 0) {
        await interaction.reply({ content: 'No nodes found.', flags: MessageFlags.Ephemeral });
        return;
      }

      await interaction.reply({
        content: nodes.map(describeNode).join('\n'),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (subcommand === 'rename') {
      const nodeId = interaction.options.getString('node', true);
      const name = interaction.options.getString('name', true);

      const renamed = ctx.store.nodes.rename(nodeId, name);

      if (!renamed) {
        await interaction.reply({ content: `No node found with id \`${nodeId}\`.`, flags: MessageFlags.Ephemeral });
        return;
      }

      await interaction.reply({ content: `Renamed to **${renamed.displayName}**.`, flags: MessageFlags.Ephemeral });
      return;
    }

    if (subcommand === 'delete') {
      const nodeId = interaction.options.getString('node', true);
      const deleted = ctx.store.nodes.delete(nodeId);

      await interaction.reply({
        content: deleted
          ? `Node \`${nodeId}\` and any links referencing it were deleted.`
          : `No node found with id \`${nodeId}\`.`,
        flags: MessageFlags.Ephemeral,
      });
    }
  },

  async autocomplete(interaction, ctx) {
    const focused = interaction.options.getFocused();
    const matches = ctx.store.nodes.findByDisplayNamePrefix(focused);

    await interaction.respond(
      matches.map((node) => ({
        name: `${node.displayName || '(unnamed)'} (${node.kind})`,
        value: node.id,
      })),
    );
  },
};
