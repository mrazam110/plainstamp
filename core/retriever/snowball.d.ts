declare module "snowball-stemmers" {
  const m: { newStemmer(lang: string): { stem(word: string): string } };
  export default m;
}
