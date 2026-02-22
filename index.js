require('dotenv').config();
const { 
    Client, 
    GatewayIntentBits, 
    Partials, 
    REST, 
    Routes, 
    SlashCommandBuilder, 
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
} = require('discord.js');

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID;

const client = new Client({ 
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages],
    partials: [Partials.Channel] 
});

const sessionCache = new Map();

const tabelaRecompensas = {
    1: { xp: 500, dinheiro: 50 }, 2: { xp: 950, dinheiro: 75 }, 3: { xp: 1400, dinheiro: 100 }, 4: { xp: 1700, dinheiro: 250 },
    5: { xp: 2150, dinheiro: 375 }, 6: { xp: 2400, dinheiro: 500 }, 7: { xp: 2650, dinheiro: 625 }, 8: { xp: 2850, dinheiro: 750 },
    9: { xp: 3200, dinheiro: 1000 }, 10: { xp: 3350, dinheiro: 1500 }, 11: { xp: 3650, dinheiro: 2000 }, 12: { xp: 3800, dinheiro: 2500 },
    13: { xp: 4100, dinheiro: 3250 }, 14: { xp: 4200, dinheiro: 4250 }, 15: { xp: 4300, dinheiro: 5500 }, 16: { xp: 4350, dinheiro: 7750 },
    17: { xp: 4650, dinheiro: 10000 }, 18: { xp: 4700, dinheiro: 12500 }, 19: { xp: 4950, dinheiro: 15000 }, 20: { xp: 5000, dinheiro: 18000 }
};

const modificadores = {
    'normal': { mult: 1.0, nome: 'Normal (0%)' },
    'dificil': { mult: 1.1, nome: 'Difícil (+10%)' },
    'tormenta': { mult: 1.2, nome: 'Tormenta (+20%)' }
};

const commands = [
    new SlashCommandBuilder()
        .setName('recompensa')
        .setDescription('Calcula o XP e o Dinheiro da missão.')
        .addIntegerOption(opt => opt.setName('nd').setDescription('O ND da missão (1 a 20)').setRequired(true).setMinValue(1).setMaxValue(20))
        .addStringOption(opt => opt.setName('dificuldade').setDescription('A dificuldade').setRequired(true)
            .addChoices({ name: 'Normal', value: 'normal' }, { name: 'Difícil', value: 'dificil' }, { name: 'Tormenta', value: 'tormenta' })),
    
    new SlashCommandBuilder()
        .setName('criarmissao')
        .setDescription('Abre o formulário para criar uma missão no mural.')
        .addIntegerOption(opt => opt.setName('vagas').setDescription('Número de vagas disponíveis').setRequired(true).setMinValue(1).setMaxValue(10))
        .addStringOption(opt => opt.setName('dificuldade').setDescription('Dificuldade').setRequired(true)
            .addChoices({ name: 'Normal', value: 'Normal' }, { name: 'Difícil', value: 'Difícil' }, { name: 'Tormenta 20%', value: 'Tormenta 20%' }))
        .addStringOption(opt => opt.setName('data_hora').setDescription('Data e horário da sessão (ex: Hoje 20:00)').setRequired(true))
].map(command => command.toJSON());

const rest = new REST({ version: '10' }).setToken(token);

client.once('ready', async () => {
    console.log(`Bot online como ${client.user.tag}!`);
    try {
        await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
        console.log('Comandos registrados!');
    } catch (error) {
        console.error(error);
    }
});

client.on('interactionCreate', async interaction => {

    // === COMANDOS DE BARRA ===
    if (interaction.isChatInputCommand()) {
        if (interaction.commandName === 'recompensa') {
            const nd = interaction.options.getInteger('nd');
            const dif = interaction.options.getString('dificuldade');
            const xpFinal = Math.floor(tabelaRecompensas[nd].xp * modificadores[dif].mult);
            const dinFinal = Math.floor(tabelaRecompensas[nd].dinheiro * modificadores[dif].mult);

            const embed = new EmbedBuilder().setColor('#D0021B').setTitle(`Recompensa da Missão | ND ${nd}`).addFields(
                { name: 'Dificuldade', value: modificadores[dif].nome, inline: false },
                { name: 'Experiência', value: `${xpFinal} XP`, inline: true },
                { name: 'Dinheiro', value: `T$ ${dinFinal}`, inline: true }
            );
            await interaction.reply({ embeds: [embed] });
        }

        if (interaction.commandName === 'criarmissao') {
            const sessionId = interaction.id;
            sessionCache.set(sessionId, {
                vagas: interaction.options.getInteger('vagas'),
                dif: interaction.options.getString('dificuldade'),
                dataHora: interaction.options.getString('data_hora'),
                gmId: interaction.user.id
            });

            const modal = new ModalBuilder().setCustomId(`modal_missao_${sessionId}`).setTitle('Detalhes da Missão');
            modal.addComponents(
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('nome').setLabel('Nome da Missão').setStyle(TextInputStyle.Short).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('nd_permitido').setLabel('Nível de Desafio Permitido').setPlaceholder('Ex: 12 - 14').setStyle(TextInputStyle.Short).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('estilo').setLabel('Estilo de Jogo').setStyle(TextInputStyle.Short).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('enredo').setLabel('Enredo').setStyle(TextInputStyle.Paragraph).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('observacoes').setLabel('Observações').setStyle(TextInputStyle.Paragraph).setRequired(false))
            );
            await interaction.showModal(modal);
        }
    }

    // === MODAL ===
    if (interaction.isModalSubmit()) {
        if (interaction.customId.startsWith('modal_missao_')) {
            const sessionId = interaction.customId.split('_')[2];
            const sessionData = sessionCache.get(sessionId);
            if (!sessionData) return interaction.reply({ content: 'Tempo expirou!', ephemeral: true });

            const nome = interaction.fields.getTextInputValue('nome');
            const ndPermitido = interaction.fields.getTextInputValue('nd_permitido');
            const estilo = interaction.fields.getTextInputValue('estilo');
            const enredo = interaction.fields.getTextInputValue('enredo');
            const obs = interaction.fields.getTextInputValue('observacoes') || 'Nenhuma.';

            const listaVagas = Array(sessionData.vagas).fill('• Vazio').join('\n');
            const mensagemTexto = `**Missão:** ${nome}\n**Mestre:** <@${sessionData.gmId}>\n**Nível de Desafio Permitido:** ND ${ndPermitido}\n**Dificuldade:** ${sessionData.dif}\n**Data e Hora:** ${sessionData.dataHora}\n\n**Vagas:** 0/${sessionData.vagas}\n${listaVagas}`;
            
            const embed = new EmbedBuilder().setColor('#1C1C28').addFields(
                { name: 'Estilo de Jogo', value: estilo, inline: false },
                { name: 'Enredo', value: enredo, inline: false },
                { name: 'Observações', value: obs, inline: false }
            );

            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`join_${sessionData.gmId}`).setLabel('Participar').setStyle(ButtonStyle.Primary));
            await interaction.reply({ content: mensagemTexto, embeds: [embed], components: [row] });
            sessionCache.delete(sessionId);
        }
    }

    // === BOTÕES DE PARTICIPAR / ACEITAR / RECUSAR / REMOVER ===
    if (interaction.isButton()) {
        
        // 1. Jogador clica em Participar
        if (interaction.customId.startsWith('join_')) {
            const gmId = interaction.customId.split('_')[1];
            const playerId = interaction.user.id;
            const msg = interaction.message;

            if (gmId === playerId) return interaction.reply({ content: "Você é o mestre desta missão!", ephemeral: true });

            try {
                const gm = await client.users.fetch(gmId);
                const aceitarBtn = new ButtonBuilder().setCustomId(`acc_${playerId}_${msg.guildId}_${msg.channelId}_${msg.id}`).setLabel('Aceitar').setStyle(ButtonStyle.Success);
                const recusarBtn = new ButtonBuilder().setCustomId(`rej_${playerId}`).setLabel('Recusar').setStyle(ButtonStyle.Danger);
                const dmRow = new ActionRowBuilder().addComponents(aceitarBtn, recusarBtn);

                await gm.send({
                    content: `🔔 <@${playerId}> pediu para participar da sua missão!\nLink: https://discord.com/channels/${msg.guildId}/${msg.channelId}/${msg.id}`,
                    components: [dmRow]
                });
                await interaction.reply({ content: "📩 Pedido enviado ao mestre! Aguarde a resposta.", ephemeral: true });
            } catch (error) {
                await interaction.reply({ content: "❌ Ocorreu um erro. Talvez o Mestre esteja com a DM fechada.", ephemeral: true });
            }
        }

        // 2. Mestre clica em Aceitar
        if (interaction.customId.startsWith('acc_')) {
            const [, playerId, guildId, channelId, msgId] = interaction.customId.split('_');
            try {
                const guild = await client.guilds.fetch(guildId);
                const channel = await guild.channels.fetch(channelId);
                const message = await channel.messages.fetch(msgId);
                let content = message.content;

                if (content.includes('• Vazio')) {
                    content = content.replace('• Vazio', `• <@${playerId}>`);
                    const match = content.match(/\*\*Vagas:\*\* (\d+)\/(\d+)/);
                    if (match) {
                        const atual = parseInt(match[1]) + 1;
                        const max = match[2];
                        content = content.replace(`**Vagas:** ${match[1]}/${max}`, `**Vagas:** ${atual}/${max}`);
                    }
                    await message.edit({ content: content });
                    
                    const player = await client.users.fetch(playerId);
                    await player.send(`✅ Você foi **ACEITO** na missão no servidor ${guild.name}!\nLink: https://discord.com/channels/${guildId}/${channelId}/${msgId}`);
                    
                    // --- NOVIDADE: Muda os botões para "Remover Jogador" em vez de apagar ---
                    const removerBtn = new ButtonBuilder()
                        .setCustomId(`rem_${playerId}_${guildId}_${channelId}_${msgId}`)
                        .setLabel('Remover Jogador')
                        .setStyle(ButtonStyle.Secondary);
                    const remRow = new ActionRowBuilder().addComponents(removerBtn);

                    await interaction.update({ 
                        content: `✅ Jogador <@${playerId}> aceito! Caso ele desista ou precise ser retirado, clique abaixo.`, 
                        components: [remRow] 
                    });
                } else {
                    await interaction.update({ content: `❌ A missão já está lotada!`, components: [] });
                }
            } catch (error) {
                await interaction.reply({ content: "Erro. A mensagem original pode ter sido apagada.", ephemeral: true });
            }
        }

        // 3. Mestre clica em Recusar
        if (interaction.customId.startsWith('rej_')) {
            const playerId = interaction.customId.split('_')[1];
            try {
                const player = await client.users.fetch(playerId);
                await player.send(`❌ O mestre recusou a sua participação na missão desta vez.`);
                await interaction.update({ content: `🚫 Jogador <@${playerId}> recusado.`, components: [] });
            } catch (error) {
                console.error(error);
            }
        }

        // 4. Mestre clica em Remover Jogador (Novo!)
        if (interaction.customId.startsWith('rem_')) {
            const [, playerId, guildId, channelId, msgId] = interaction.customId.split('_');
            try {
                const guild = await client.guilds.fetch(guildId);
                const channel = await guild.channels.fetch(channelId);
                const message = await channel.messages.fetch(msgId);
                let content = message.content;
                const playerMention = `• <@${playerId}>`;

                // Verifica se o jogador realmente está lá
                if (content.includes(playerMention)) {
                    // Substitui o jogador por Vazio
                    content = content.replace(playerMention, '• Vazio');
                    
                    // Atualiza a contagem reduzindo em 1
                    const match = content.match(/\*\*Vagas:\*\* (\d+)\/(\d+)/);
                    if (match) {
                        const atual = parseInt(match[1]) - 1;
                        const max = match[2];
                        content = content.replace(`**Vagas:** ${match[1]}/${max}`, `**Vagas:** ${atual}/${max}`);
                    }
                    await message.edit({ content: content });

                    // Avisa o jogador
                    const player = await client.users.fetch(playerId);
                    await player.send(`ℹ️ Você foi removido da missão no servidor ${guild.name} e sua vaga foi liberada.`);

                    await interaction.update({ content: `✅ Jogador <@${playerId}> removido. Vaga liberada no mural!`, components: [] });
                } else {
                    await interaction.update({ content: `⚠️ O jogador não foi encontrado na lista de vagas.`, components: [] });
                }
            } catch (error) {
                await interaction.reply({ content: "Erro ao tentar remover. A mensagem original pode ter sumido.", ephemeral: true });
            }
        }
    }
});

client.login(token);