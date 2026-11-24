const featured = [
  ['Operation Platypus', 'Get another guest to say “platypus” without directly asking them to.', 100, true],
  ['Operation Musical Chairs', 'Convince two guests to exchange seats without revealing your mission.', 250, true],
  ['Operation Standing Ovation', 'Get at least five guests to applaud at the same time.', 500, true],
  ['Photo Evidence', 'Get someone to show you a photo on their phone.', 100, true],
  ['Juggling Act', 'Convince someone that you know how to juggle.', 150, true],
  ['Origin Story', 'Get someone to tell a childhood story.', 150, true],
  ['Undercover Couture', 'Get three people to compliment your outfit.', 200, true],
  ['Round of Applause', 'Start a round of applause.', 200, true],
  ['Sandwich Service', 'Get someone to make you a sandwich.', 250, false],
  ['Group Evidence', 'Get four people to participate in a group selfie.', 300, true],
  ['Full Performance', 'Get someone to sing an entire song.', 400, true],
  ['The Ridiculous Toast', 'Convince five people to toast something ridiculous.', 500, false],
  ['Window Watch', 'Get someone to look outside for something that isn’t there.', 500, false],
];

const prompts = [
  ['Codeword', 'Get a guest to say “{detail}” without saying it yourself first.', 100,
    ['waffle', 'penguin', 'moonwalk', 'pickle', 'unicorn', 'pajamas', 'sprinkles', 'kangaroo', 'cactus', 'giggle', 'snowman', 'noodles', 'tornado', 'marshmallow', 'spaceship', 'flamingo', 'confetti', 'raccoon', 'dinosaur', 'pumpkin']],
  ['Memory File', 'Get someone to tell you about {detail}.', 150,
    ['their first pet', 'a favorite school lunch', 'a childhood nickname', 'a memorable road trip', 'their first concert', 'their favorite birthday cake', 'a costume they once wore', 'a food they used to dislike', 'their favorite family tradition', 'a childhood toy', 'a silly family saying', 'their first snow day', 'the best gift they ever made', 'an old family recipe', 'a memorable first day of school', 'a favorite childhood book', 'a game they played as a kid', 'a song they remember from childhood', 'their favorite childhood movie', 'a funny thing a pet did']],
  ['Field Survey', 'Get two guests to separately tell you their favorite {detail}.', 150,
    ['pie', 'board game', 'holiday movie', 'sandwich', 'cartoon', 'ice cream flavor', 'pizza topping', 'breakfast food', 'wild animal', 'season', 'soup', 'potato dish', 'musical instrument', 'cookie', 'fruit', 'way to spend a rainy day', 'holiday decoration', 'Thanksgiving side', 'childhood snack', 'movie villain']],
  ['Silent Signal', 'Get someone to {detail} without directly asking them to do it.', 200,
    ['give you a high five', 'show you how to snap their fingers', 'draw a star', 'give you a thumbs-up', 'mime throwing a basketball', 'whistle a tune', 'spin around once', 'do a drumroll on their knees', 'make a paper airplane', 'count backward from ten', 'show you a dance move', 'draw a smiley face', 'tell a knock-knock joke', 'walk like a penguin', 'spell their name backward', 'make a turkey sound', 'pretend to paddle a canoe', 'do a finger puppet impression', 'pretend to conduct an orchestra', 'strike a superhero pose']],
  ['Double Agent', 'Get two guests to agree that {detail}.', 250,
    ['mashed potatoes count as a main course', 'a duck would make a good mayor', 'dessert should come first', 'pajamas count as formal wear', 'a turkey needs a stage name', 'a potato deserves its own holiday', 'the moon should have a gift shop', 'robots would be bad at hide-and-seek', 'a goose would make a good detective', 'a pie contest needs a theme song', 'a dragon could toast a perfect marshmallow', 'every house needs a secret handshake', 'a squirrel should host a cooking show', 'the best sandwich has a ridiculous name', 'a capybara would make a good roommate', 'a penguin should deliver the mail', 'all cookies deserve a tiny trophy', 'a submarine should have a snack bar', 'a pumpkin can look distinguished', 'a talking coat rack belongs in a movie']],
  ['Secret Committee', 'Get three guests to each contribute a different suggestion for {detail}.', 300,
    ['a turkey superhero name', 'a new Thanksgiving tradition', 'the name of a family band', 'a secret handshake', 'an imaginary pie flavor', 'the title of a family movie', 'a restaurant run by penguins', 'a game involving oven mitts', 'a nickname for the dessert table', 'a mascot for leftovers', 'the name of a time-traveling chef', 'an unusual ice cream truck jingle', 'a motto for the dinner table', 'a fictional town famous for potatoes', 'a theme for a family talent show', 'the name of a turkey spaceship', 'a team chant for the cleanup crew', 'a prize for the best nap', 'a new name for stuffing', 'an imaginary holiday between Thanksgiving and Friday']],
  ['Group Assignment', 'Get at least four guests to {detail}.', 400,
    ['freeze in place for five seconds together', 'say the same silly word on cue', 'give a simultaneous thumbs-up', 'act out a silent band together', 'vote on a name for an imaginary pet turkey', 'build a story one sentence at a time', 'make the same animal noise together', 'try a simple rhythm you clap', 'pretend to row a boat together', 'do a countdown to an imaginary rocket launch', 'form a human clock with their arms', 'pose as a pretend album cover', 'contribute a line to a made-up commercial', 'agree on a secret group nickname', 'do a seated dance move together', 'give a standing salute to dessert', 'take turns naming fictional detectives', 'sing the same chorus together']],
];

export const missions = [...featured, ...prompts.flatMap(([name, template, points, details]) =>
  details.map((detail, index) => [`${name} ${index + 1}`, template.replace('{detail}', detail), points, points <= 300])
)].map(([title, description, points, family], index) => ({
  id: index + 1, title, description, points, family,
  difficulty: points < 200 ? 'Easy' : points < 400 ? 'Medium' : 'Hard',
}));
