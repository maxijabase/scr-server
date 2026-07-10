import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { InvalidRegexError } from '../../store/filters.js';
import type { SlashCommandModule } from '../commandModule.js';

export const filterCommand: SlashCommandModule = {
  data: new SlashCommandBuilder()
    .setName('filter')
    .setDescription('Manage the content filter (regular expressions applied to relayed messages)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) =>
      sub
        .setName('add')
        .setDescription('Add a filter pattern')
        .addStringOption((opt) =>
          opt.setName('pattern').setDescription('A regular expression').setRequired(true),
        ),
    )
    .addSubcommand((sub) => sub.setName('list').setDescription('List all filter patterns'))
    .addSubcommand((sub) =>
      sub
        .setName('remove')
        .setDescription('Remove a filter pattern')
        .addIntegerOption((opt) =>
          opt.setName('id').setDescription('The filter id (see /filter list)').setRequired(true),
        ),
    ),

  async execute(interaction, ctx) {
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'add') {
      const pattern = interaction.options.getString('pattern', true);

      try {
        const filter = ctx.store.filters.add(pattern);

        await interaction.reply({
          content: `Added filter \`#${filter.id}\`: \`${filter.pattern}\``,
          flags: MessageFlags.Ephemeral,
        });
      } catch (error) {
        if (error instanceof InvalidRegexError) {
          await interaction.reply({ content: error.message, flags: MessageFlags.Ephemeral });
          return;
        }

        throw error;
      }
      return;
    }

    if (subcommand === 'list') {
      const filters = ctx.store.filters.list();

      if (filters.length === 0) {
        await interaction.reply({ content: 'No filters configured.', flags: MessageFlags.Ephemeral });
        return;
      }

      await interaction.reply({
        content: filters.map((f) => `\`#${f.id}\`: \`${f.pattern}\``).join('\n'),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (subcommand === 'remove') {
      const id = interaction.options.getInteger('id', true);
      const removed = ctx.store.filters.remove(id);

      await interaction.reply({
        content: removed ? `Removed filter \`#${id}\`.` : `No filter found with id \`#${id}\`.`,
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};
