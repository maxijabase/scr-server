import { ChannelType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { isLinkableMessageType, type LinkableMessageType } from '../../protocol/messages.js';
import type { LinkDirection, LinkRecord, NodeRecord } from '../../store/types.js';
import type { SlashCommandModule } from '../commandModule.js';

function describeLink(link: LinkRecord, source: NodeRecord | undefined, target: NodeRecord | undefined): string {
  const arrow = link.direction === 'two_way' ? '<->' : '->';
  const sourceName = source?.displayName || link.sourceNodeId;
  const targetName = target?.displayName || link.targetNodeId;

  return `\`#${link.id}\` **${sourceName}** ${arrow} **${targetName}** (${link.allowedTypes.join(', ')})`;
}

export const linkCommand: SlashCommandModule = {
  data: new SlashCommandBuilder()
    .setName('link')
    .setDescription('Manage links between relay nodes')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) =>
      sub
        .setName('create')
        .setDescription('Link a node to a Discord channel')
        .addStringOption((opt) =>
          opt
            .setName('source')
            .setDescription('The existing node to link from (e.g. a game server)')
            .setRequired(true)
            .setAutocomplete(true),
        )
        .addChannelOption((opt) =>
          opt
            .setName('target')
            .setDescription('The Discord channel to link to')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true),
        )
        .addStringOption((opt) =>
          opt
            .setName('direction')
            .setDescription('Whether messages flow one way or both ways')
            .setRequired(true)
            .addChoices(
              { name: 'Two-way (both directions)', value: 'two_way' },
              { name: 'One-way (source to target only)', value: 'one_way' },
            ),
        )
        .addStringOption((opt) =>
          opt
            .setName('types')
            .setDescription('Which message types this link carries')
            .setRequired(true)
            .addChoices(
              { name: 'Chat and events', value: 'chat,event' },
              { name: 'Chat only', value: 'chat' },
              { name: 'Events only', value: 'event' },
            ),
        ),
    )
    .addSubcommand((sub) => sub.setName('list').setDescription('List all links'))
    .addSubcommand((sub) =>
      sub
        .setName('delete')
        .setDescription('Delete a link')
        .addIntegerOption((opt) =>
          opt
            .setName('link')
            .setDescription('The link to delete')
            .setRequired(true)
            .setAutocomplete(true),
        ),
    ),

  async execute(interaction, ctx) {
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'create') {
      const sourceId = interaction.options.getString('source', true);
      const channel = interaction.options.getChannel('target', true);
      const direction = interaction.options.getString('direction', true) as LinkDirection;
      const typesRaw = interaction.options.getString('types', true);

      const source = ctx.store.nodes.getById(sourceId);

      if (!source) {
        await interaction.reply({
          content: `No node found with id \`${sourceId}\`. Use the autocomplete list to pick an existing node.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const allowedTypes = typesRaw
        .split(',')
        .map((t) => t.trim())
        .filter((t): t is LinkableMessageType => isLinkableMessageType(t));

      const target = ctx.store.nodes.getOrCreate(channel.id, 'discord_channel', channel.name ?? channel.id);

      try {
        const link = ctx.store.links.create(source.id, target.id, direction, allowedTypes);

        await interaction.reply({
          content: `Created link: ${describeLink(link, source, target)}`,
          flags: MessageFlags.Ephemeral,
        });
      } catch {
        await interaction.reply({
          content: `A link between **${source.displayName}** and **${target.displayName}** already exists.`,
          flags: MessageFlags.Ephemeral,
        });
      }
      return;
    }

    if (subcommand === 'list') {
      const links = ctx.store.links.list();

      if (links.length === 0) {
        await interaction.reply({ content: 'No links found.', flags: MessageFlags.Ephemeral });
        return;
      }

      const lines = links.map((link) =>
        describeLink(
          link,
          ctx.store.nodes.getById(link.sourceNodeId),
          ctx.store.nodes.getById(link.targetNodeId),
        ),
      );

      await interaction.reply({ content: lines.join('\n'), flags: MessageFlags.Ephemeral });
      return;
    }

    if (subcommand === 'delete') {
      const linkId = interaction.options.getInteger('link', true);
      const deleted = ctx.store.links.delete(linkId);

      await interaction.reply({
        content: deleted ? `Link \`#${linkId}\` deleted.` : `No link found with id \`#${linkId}\`.`,
        flags: MessageFlags.Ephemeral,
      });
    }
  },

  async autocomplete(interaction, ctx) {
    const focusedOption = interaction.options.getFocused(true);

    if (focusedOption.name === 'source') {
      const matches = ctx.store.nodes.findByDisplayNamePrefix(String(focusedOption.value));

      await interaction.respond(
        matches.map((node) => ({
          name: `${node.displayName || '(unnamed)'} (${node.kind})`,
          value: node.id,
        })),
      );
      return;
    }

    if (focusedOption.name === 'link') {
      const needle = String(focusedOption.value).toLowerCase();

      const choices = ctx.store.links
        .list()
        .map((link) => ({
          link,
          label: describeLink(
            link,
            ctx.store.nodes.getById(link.sourceNodeId),
            ctx.store.nodes.getById(link.targetNodeId),
          ),
        }))
        .filter(({ label }) => label.toLowerCase().includes(needle))
        .slice(0, 25);

      await interaction.respond(
        choices.map(({ link, label }) => ({
          name: label.replace(/[*`]/g, '').slice(0, 100),
          value: link.id,
        })),
      );
    }
  },
};
