export interface Post {
  id: number;
  message: string;
  fingerprint: string;
  owner: string | null;
  ownerVerified: boolean;
  timestamp: string;
}

let nextId = 1;
const posts: Post[] = [];

export function addPost(
  message: string,
  fingerprint: string,
  owner: string | null,
  ownerVerified: boolean,
): Post {
  const post: Post = {
    id: nextId++,
    message,
    fingerprint,
    owner,
    ownerVerified,
    timestamp: new Date().toISOString(),
  };
  posts.unshift(post);
  return post;
}

export function getPosts(): Post[] {
  return posts;
}
