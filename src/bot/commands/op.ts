import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import type { SlashCommandModule } from '../commandModule.js';

/**
 * Manages the set of Discord users (besides the bot owner) authorized to
 * run "!"-prefixed messages as server commands on linked game servers.
 *
 * Every subcommand additionally requires the caller to be the bot owner
 * (SCR_DISCORD_OWNER_ID) -- this is a runtime identity check rather than a
 * Discord permission, since Discord's permission system can't target one
 * specific user id declaratively. `.setDefaultMemberPermissions` below is
 * only a coarse first filter (hides it from regular members) and is not a
 * substitute for the owner check in `execute`.
 */
export const opCommand: SlashCommandModule = {
  data: new SlashCommandBuilder()
    .setName('op')
    .setDescription('Manage Discord users authorized to run !commands on the game server')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((sub) =>
      sub
        .setName('create')
        .setDescription('Authorize a Discord user to run !commands')
        .addUserOption((opt) =>
          opt.setName('user').setDescription('The Discord user to authorize').setRequired(true),
        ),
    )
    .addSubcommand((sub) => sub.setName('list').setDescription('List authorized operators'))
    .addSubcommand((sub) =>
      sub
        .setName('remove')
        .setDescription('Revoke a Discord user\'s authorization to run !commands')
        .addUserOption((opt) =>
          opt.setName('user').setDescription('The Discord user to revoke').setRequired(true),
        ),
    ),

  async execute(interaction, ctx) {
    if (!ctx.ownerId) {
      await interaction.reply({
        content: 'SCR_DISCORD_OWNER_ID is not configured -- /op is disabled.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (interaction.user.id !== ctx.ownerId) {
      await interaction.reply({
        content: 'Only the bot owner can manage operators.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'create') {
      const user = interaction.options.getUser('user', true);
      ctx.store.operators.add(user.id, ctx.ownerId);

      await interaction.reply({
        content: `Authorized <@${user.id}> to run !commands.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (subcommand === 'list') {
      const operators = ctx.store.operators.list();

      if (operators.length === 0) {
        await interaction.reply({ content: 'No operators configured.', flags: MessageFlags.Ephemeral });
        return;
      }

      await interaction.reply({
        content: operators.map((op) => `<@${op.discordUserId}>`).join('\n'),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (subcommand === 'remove') {
      const user = interaction.options.getUser('user', true);
      const removed = ctx.store.operators.remove(user.id);

      await interaction.reply({
        content: removed
          ? `Revoked <@${user.id}>'s authorization to run !commands.`
          : `<@${user.id}> is not an operator.`,
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};
